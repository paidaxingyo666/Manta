import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { trackSshConnectionChannelLifetime } from './ssh-connection-channel-lifetime'
import { SshConnectionWorkLedger } from './ssh-connection-work-ledger'

const signal = () => new AbortController().signal

it('settles the opening only when the channel emits close', async () => {
  const ledger = new SshConnectionWorkLedger()
  const channel = new EventEmitter()
  trackSshConnectionChannelLifetime(ledger.beginChannelOpen(), channel)
  const fence = ledger.fenceForReset()
  channel.emit('end')
  expect(fence.assertDrained).toThrow('ssh_connection_work_not_drained')
  channel.emit('close')
  await fence.drain(signal())
  expect(channel.listenerCount('error')).toBe(0)
})

it('treats an already closed channel as settled', async () => {
  const ledger = new SshConnectionWorkLedger()
  trackSshConnectionChannelLifetime(
    ledger.beginChannelOpen(),
    Object.assign(new EventEmitter(), { closed: true })
  )
  await ledger.fenceForReset().drain(signal())
})

it('keeps a fenced channel error unverifiable even after it closes', async () => {
  const ledger = new SshConnectionWorkLedger()
  const channel = new EventEmitter()
  trackSshConnectionChannelLifetime(ledger.beginChannelOpen(), channel)
  const fence = ledger.fenceForReset()
  const failure = new Error('channel write failed')
  channel.emit('error', failure)
  channel.emit('close')
  await expect(fence.drain(signal())).rejects.toBe(failure)
})

it('does not carry a pre-fence error from a channel that closed before the fence', async () => {
  const ledger = new SshConnectionWorkLedger()
  const channel = new EventEmitter()
  trackSshConnectionChannelLifetime(ledger.beginChannelOpen(), channel)
  channel.emit('error', new Error('closed before reset'))
  channel.emit('close')
  await ledger.fenceForReset().drain(signal())
})

it.each([undefined, null, {}, { on: () => {} }])(
  'marks an untrackable open result (%s) unverifiable instead of settled',
  async (value) => {
    const ledger = new SshConnectionWorkLedger()
    trackSshConnectionChannelLifetime(ledger.beginChannelOpen(), value)
    await expect(ledger.fenceForReset().drain(signal())).rejects.toThrow(
      'ssh_connection_channel_lifetime_unverifiable'
    )
  }
)

it('runs the injected admission check before admitting work', () => {
  const ledger = new SshConnectionWorkLedger(undefined, () => {
    throw new Error('connection disposed')
  })
  expect(() => ledger.beginChannelOpen()).toThrow('connection disposed')
})
