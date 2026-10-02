import { describe, expect, it, vi } from 'vitest'
import type { WorkerRequestTransport } from '../lazy-worker-thread-host'
import { ForeignSqliteReaderClient, ForeignSqliteReaderLane } from './foreign-sqlite-reader-client'
import type { ForeignSqliteReaderRequest } from './foreign-sqlite-reader-protocol'

const FAILURE = { status: 'error', error: 'Unable to read the Cursor desktop login' }
const OK = {
  status: 'ok',
  profile: { accessToken: 't', email: null, membershipType: null, subscriptionStatus: null }
}

// Records posted requests and lets a test drive message/exit without a built worker.
class FakeWorker implements WorkerRequestTransport {
  posted: ForeignSqliteReaderRequest[] = []
  terminated = false
  private listeners = new Map<string, Set<(arg?: unknown) => void>>()

  on(event: string, listener: (arg?: unknown) => void): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }

  off(event: string, listener: (arg?: unknown) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  removeAllListeners(): this {
    this.listeners.clear()
    return this
  }

  unref(): void {}

  async terminate(): Promise<number> {
    this.terminated = true
    return 1
  }

  postMessage(request: ForeignSqliteReaderRequest): void {
    this.posted.push(request)
  }

  emit(event: string, arg?: unknown): void {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) {
      listener(arg)
    }
  }

  reply(value: unknown): void {
    const last = this.posted.at(-1)
    if (!last) {
      throw new Error('no request posted')
    }
    this.emit('message', { id: last.id, ok: true, value })
  }
}

function fakeFactory(workers: FakeWorker[]): () => FakeWorker {
  return () => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('ForeignSqliteReaderClient', () => {
  it('returns the reader result the worker posts', async () => {
    const workers: FakeWorker[] = []
    const client = new ForeignSqliteReaderClient({ workerFactory: fakeFactory(workers), log() {} })
    const read = client.readCursorProfile('/a/state.vscdb')
    expect(workers[0]?.posted[0]).toMatchObject({ kind: 'cursorProfile', dbPath: '/a/state.vscdb' })
    workers[0]?.reply(OK)
    await expect(read).resolves.toEqual(OK)
    client.dispose()
  })

  it('returns the failure value when the read times out', async () => {
    const workers: FakeWorker[] = []
    const client = new ForeignSqliteReaderClient({
      workerFactory: fakeFactory(workers),
      log() {},
      timeoutMs: 5
    })
    await expect(client.readCursorProfile('/a/state.vscdb')).resolves.toEqual(FAILURE)
    expect(workers[0]?.terminated).toBe(true)
    client.dispose()
  })

  it('gives a Cursor read 10 s before failing it', async () => {
    vi.useFakeTimers()
    try {
      const workers: FakeWorker[] = []
      const client = new ForeignSqliteReaderClient({
        workerFactory: fakeFactory(workers),
        log() {}
      })
      let result: unknown
      void client.readCursorProfile('/a/state.vscdb').then((value) => {
        result = value
      })
      await vi.advanceTimersByTimeAsync(9_999)
      expect(result).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(result).toEqual(FAILURE)
      client.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the failure value when the worker crashes', async () => {
    const workers: FakeWorker[] = []
    const client = new ForeignSqliteReaderClient({ workerFactory: fakeFactory(workers), log() {} })
    const read = client.readCursorProfile('/a/state.vscdb')
    workers[0]?.emit('exit', 1)
    await expect(read).resolves.toEqual(FAILURE)
    client.dispose()
  })

  it('returns the failure value when the worker replies with an error or a malformed value', async () => {
    const workers: FakeWorker[] = []
    const client = new ForeignSqliteReaderClient({ workerFactory: fakeFactory(workers), log() {} })
    const errored = client.readCursorProfile('/a/state.vscdb')
    workers[0]?.emit('message', { id: workers[0].posted[0]?.id, ok: false, error: 'boom' })
    await expect(errored).resolves.toEqual(FAILURE)
    const malformed = client.readCursorProfile('/a/state.vscdb')
    workers[0]?.reply({ status: 'ok' })
    await expect(malformed).resolves.toEqual(FAILURE)
    client.dispose()
  })

  it('returns the failure value without reading when no worker can start', async () => {
    const logs: string[] = []
    const client = new ForeignSqliteReaderClient({
      workerFactory: () => {
        throw new Error('entry not found')
      },
      log: (message) => logs.push(message)
    })
    // A real path: a main-thread fallback would read it and answer `ok`.
    await expect(client.readCursorProfile(__filename)).resolves.toEqual(FAILURE)
    expect(logs.join('\n')).toContain('entry not found')
    client.dispose()
  })

  it('shares one in-flight read between concurrent callers for the same database', async () => {
    const workers: FakeWorker[] = []
    const client = new ForeignSqliteReaderClient({ workerFactory: fakeFactory(workers), log() {} })
    const first = client.readCursorProfile('/a/state.vscdb')
    const second = client.readCursorProfile('/a/state.vscdb')
    expect(second).toBe(first)
    expect(workers[0]?.posted).toHaveLength(1)
    workers[0]?.reply(OK)
    await expect(Promise.all([first, second])).resolves.toEqual([OK, OK])

    // Settled reads are not cached: the next call reads again.
    const third = client.readCursorProfile('/a/state.vscdb')
    await settle()
    expect(workers[0]?.posted).toHaveLength(2)
    workers[0]?.reply(OK)
    await third
    client.dispose()
  })

  it('does not share reads across different databases', () => {
    const workers: FakeWorker[] = []
    const client = new ForeignSqliteReaderClient({ workerFactory: fakeFactory(workers), log() {} })
    const first = client.readCursorProfile('/a/state.vscdb')
    const second = client.readCursorProfile('/b/state.vscdb')
    expect(second).not.toBe(first)
    client.dispose()
  })
})

describe('ForeignSqliteReaderLane', () => {
  it('gives each reader its own thread from the same factory', async () => {
    const workers: FakeWorker[] = []
    const settings = {
      workerFactory: fakeFactory(workers),
      log() {},
      timeoutMs: 60_000,
      idleTeardownMs: 30_000
    }
    const parse = (value: unknown): unknown => value
    const failure = (): unknown => 'failed'
    const slow = new ForeignSqliteReaderLane('cursorProfile', parse, failure, settings)
    const other = new ForeignSqliteReaderLane('cursorProfile', parse, failure, settings)

    const stuck = slow.read('/slow.db', (id) => ({ id, kind: 'cursorProfile', dbPath: '/slow.db' }))
    const quick = other.read('/quick.db', (id) => ({
      id,
      kind: 'cursorProfile',
      dbPath: '/quick.db'
    }))
    expect(workers).toHaveLength(2)
    // The second reader answers while the first is still stuck on its database.
    workers[1]?.reply('quick')
    await expect(quick).resolves.toBe('quick')
    workers[0]?.reply('slow')
    await expect(stuck).resolves.toBe('slow')
    slow.dispose()
    other.dispose()
  })

  it('fails reads past the queue cap instead of piling them up', async () => {
    const workers: FakeWorker[] = []
    const lane = new ForeignSqliteReaderLane(
      'cursorProfile',
      (value) => value,
      () => 'failed',
      {
        workerFactory: fakeFactory(workers),
        log() {},
        timeoutMs: 60_000,
        idleTeardownMs: 30_000
      }
    )
    // One active plus eight queued fill the lane; the tenth distinct read is refused.
    const reads = Array.from({ length: 10 }, (_, index) =>
      lane.read(`/db-${index}`, (id) => ({ id, kind: 'cursorProfile', dbPath: `/db-${index}` }))
    )
    await expect(reads[9]).resolves.toBe('failed')
    expect(workers[0]?.posted).toHaveLength(1)
    workers[0]?.reply('first')
    await expect(reads[0]).resolves.toBe('first')
    lane.dispose()
  })

  it('shares in-flight reads by the caller key, not the database path', () => {
    const workers: FakeWorker[] = []
    const lane = new ForeignSqliteReaderLane(
      'cursorProfile',
      (value) => value,
      () => 'failed',
      { workerFactory: fakeFactory(workers), log() {}, timeoutMs: 60_000, idleTeardownMs: 30_000 }
    )
    const request = (id: number): ForeignSqliteReaderRequest => ({
      id,
      kind: 'cursorProfile',
      dbPath: '/same.db'
    })
    const first = lane.read('/same.db#a', request)
    expect(lane.read('/same.db#b', request)).not.toBe(first)
    expect(lane.read('/same.db#a', request)).toBe(first)
    lane.dispose()
  })
})
