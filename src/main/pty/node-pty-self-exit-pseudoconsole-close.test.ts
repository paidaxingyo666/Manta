import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A shell that exits by itself must still close its pseudoconsole.
 *
 * `ClosePseudoConsole` is the only thing that reaps a ConPTY's console host —
 * Manta's own job-ownership patch says so, because `CreatePseudoConsole` spawns
 * that host before the per-pty job exists and it is therefore not a job member.
 * Upstream node-pty calls it from exactly one place, `PtyKill`, which begins by
 * looking the baton up by id — and the exit watcher in `SetupExitCallback`
 * erased the baton the moment the shell died. So on the self-exit path (typing
 * `exit`, which is how panes usually close) that lookup missed, `PtyKill` did
 * nothing at all, and the pseudoconsole was never closed.
 *
 * There is a SECOND, independent defect on the same path: the `useConptyDll`
 * branch of `WindowsPtyAgent.kill()` disposed the conout worker only from an
 * `_outSocket.on('data')` handler, and no more data arrives once the shell has
 * gone — so that worker leaked too. The non-DLL branch beside it already
 * disposed unconditionally. The desktop always sets `useConptyDll`, so it hit
 * both; the relay sets neither and hit only the first.
 *
 * Measured on Windows 11 / awin, 20 cycles, handles bucketed by NT object type,
 * totals before -> after:
 *
 *   self-exit,     relay spawn     225 -> 285   becomes  219 -> 219  FLAT
 *   self-exit,     desktop spawn   239 -> 439   becomes  222 -> 222  FLAT
 *   explicit kill, relay spawn     225 -> 285   becomes  219 -> 219  FLAT
 *   explicit kill, desktop spawn   235 -> 395   becomes  219 -> 219  FLAT
 *
 * Neither fix alone is enough on the desktop: the pseudoconsole close is worth
 * +1 Process +1 File per terminal, the dispose +2 Thread +4 File.
 *
 * WHY THIS IS A PATCH-CONTENT PIN AND NOT A BEHAVIOURAL TEST: the defect is
 * only observable as a per-NT-type handle count, which needs
 * `NtQuerySystemInformation(SystemExtendedHandleInformation)`. Nothing in the
 * repo can read that, and the cheaper Windows-observable proxies do not
 * discriminate — the console host process is reaped either way (the leak is a
 * handle to an already-exited object, not an orphaned process), and the
 * `\\.\pipe\conpty-*` entries disappear either way. Both were measured and
 * rejected as assertions rather than assumed. So this pins the mechanism
 * instead, which is the real risk: a future resync of the vendored patch
 * silently dropping the hunk.
 */

const PATCH = readFileSync(join(__dirname, '../../../config/patches/node-pty@1.1.0.patch'), 'utf8')

describe('node-pty patch: pseudoconsole close on the self-exit path', () => {
  it('does not let the exit watcher free the baton while the close is still owed', () => {
    // Pinned as one block: the erase must stay INSIDE the consoleClosed guard.
    // Upstream ran it unconditionally, which is the line that caused the leak,
    // and a resync that re-flattens this is the failure mode worth catching.
    expect(PATCH).toContain(
      [
        '+      baton->shellExited = true;',
        '+      if (baton->consoleClosed) {',
        '+        const bool removed = remove_pty_baton(baton->id);',
        '+        assert(removed);',
        '+        (void)removed;',
        '+      }'
      ].join('\n')
    )
  })

  it('closes the pseudoconsole from PtyKill even after the shell has exited', () => {
    // hpc is copied out under the lock, so the close survives the baton's removal.
    expect(PATCH).toContain('+      hpc = handle->hpc;')
    expect(PATCH).toContain('+      pfnClosePseudoConsole(hpc);')
  })

  it('resolves the ConPTY DLL before it claims the close', () => {
    // LoadConptyDll throws when conpty.dll is missing. Throwing after
    // consoleClosed was set would strand the pseudoconsole for good: the retry
    // finds the work claimed and does nothing.
    const dllResolve = PATCH.indexOf('+  HANDLE hLibrary = LoadConptyDll(info, useConptyDll);')
    const claim = PATCH.indexOf('+      handle->consoleClosed = true;')
    expect(dllResolve).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(-1)
    expect(dllResolve).toBeLessThan(claim)
  })

  it('reaches hShell only under the null check the watcher can trip', () => {
    // Pinned as one block. The watcher nulls hShell on exit, and upstream
    // dereferenced it unconditionally; every remaining use — the duplication and
    // the failure fallback below it — must stay inside this guard.
    const guarded = PATCH.slice(
      PATCH.indexOf('+      if (useConptyDll && handle->hShell != nullptr) {'),
      PATCH.indexOf('+      if (handle->shellExited) {')
    )
    expect(guarded).not.toBe('')
    expect(guarded).toContain('DuplicateHandle(GetCurrentProcess(), handle->hShell')
    expect(guarded).toContain('TerminateProcess(handle->hShell, 1);')
    // No ADDED line outside that guard may terminate through hShell. Removed
    // (`-`) lines still carry upstream's unguarded call, which is the point.
    const strayAdds = PATCH.replace(guarded, '')
      .split('\n')
      .filter((line) => line.startsWith('+') && line.includes('TerminateProcess(handle->hShell'))
    expect(strayAdds).toEqual([])
  })

  it('still kills the shell when DuplicateHandle fails', () => {
    // A null hShellDup is indistinguishable from the self-exit case, so a
    // swallowed failure would leave the shell running after its pane closed —
    // a worse outcome than the leak this patch exists to fix.
    expect(PATCH).toContain(
      [
        '+          hShellDup = nullptr;',
        '+          TerminateProcess(handle->hShell, 1);',
        '+        }'
      ].join('\n')
    )
  })

  it('keeps the close idempotent so a second kill cannot double-close', () => {
    expect(PATCH).toContain('+    if (handle != nullptr && !handle->consoleClosed) {')
    expect(PATCH).toContain('+      handle->consoleClosed = true;')
  })
})

describe('node-pty patch: conout worker disposal on the self-exit path', () => {
  // The desktop's larger half: 8 of its 10 leaked handles per terminal.
  it('disposes the conout worker unconditionally in the useConptyDll branch', () => {
    expect(PATCH).toContain('+                this._conoutSocketWorker.dispose();')
    // The data handler is what never fired once the shell had gone.
    expect(PATCH).toContain("-                this._outSocket.on('data', function () {")
    expect(PATCH).toContain('-                    _this._conoutSocketWorker.dispose();')
  })

  it('applies the same change to the TypeScript source the patch also carries', () => {
    expect(PATCH).toContain('+        this._conoutSocketWorker.dispose();')
    expect(PATCH).toContain("-        this._outSocket.on('data', () => {")
  })
})
