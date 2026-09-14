/**
 * The two things a supervisor reads off a launch: what the arguments mean, and what an exit
 * code means. Both are part of the ops contract in docs/reference/mantad-operations.md.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  MANTAD_EXIT_CONFIGURATION,
  MANTAD_EXIT_FAILED,
  parseArgs,
  resolveMantadExitCode
} from './mantad-entry'
import { startOrcadWithLifecycle } from './mantad-lifecycle'
import { MantadBindAddressError } from './mantad-bind-address'
import { MantadInstanceLockError } from './mantad-instance-lock'

describe('parseArgs', () => {
  it('accepts --bind and leaves it unset when absent', () => {
    expect(parseArgs(['--bind', '0.0.0.0'])).toEqual({ bind: '0.0.0.0' })
    expect(parseArgs([])).toEqual({})
    expect(parseArgs(['--port', '6768', '--bind', '10.0.0.5', '--json'])).toEqual({
      port: 6768,
      bind: '10.0.0.5',
      json: true
    })
  })

  it('rejects --bind with no value rather than silently binding the default', () => {
    expect(() => parseArgs(['--bind'])).toThrow('--bind expects a value')
    expect(() => parseArgs(['--bind', '--json'])).not.toThrow()
  })
})

describe('resolveMantadExitCode', () => {
  it('separates a configuration fault from a generic failure', () => {
    // A supervisor must be able to stop restarting on faults that restarting cannot fix:
    // a data root owned by someone else, held by another instance, or a bad bind address.
    expect(
      resolveMantadExitCode(new MantadInstanceLockError('orcad_instance_lock_held', 'held'))
    ).toBe(MANTAD_EXIT_CONFIGURATION)
    expect(resolveMantadExitCode(new MantadBindAddressError('bad'))).toBe(MANTAD_EXIT_CONFIGURATION)
    expect(resolveMantadExitCode(new Error('port in use'))).toBe(MANTAD_EXIT_FAILED)
    expect(MANTAD_EXIT_CONFIGURATION).not.toBe(MANTAD_EXIT_FAILED)
  })
})

describe('mantad lifecycle cleanup', () => {
  it('uninstalls registered runtime resources when startup fails', async () => {
    const cleanupRuntime = vi.fn(async () => {})
    const cleanupHost = vi.fn(async () => {})

    await expect(
      startOrcadWithLifecycle(async (registerCleanup) => {
        registerCleanup(cleanupRuntime)
        await Promise.resolve()
        throw new Error('startup failed')
      }, cleanupHost)
    ).rejects.toThrow('startup failed')

    expect(cleanupRuntime).toHaveBeenCalledOnce()
    expect(cleanupHost).toHaveBeenCalledOnce()
  })

  it('preserves the startup error when rollback also fails', async () => {
    const startupError = new Error('bind failed')
    const cleanupError = new Error('daemon stop failed')
    const cleanupRuntime = vi.fn(async () => {})
    const cleanupHost = vi.fn(async () => {
      throw cleanupError
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(
        startOrcadWithLifecycle(async (registerCleanup) => {
          registerCleanup(cleanupRuntime)
          throw startupError
        }, cleanupHost)
      ).rejects.toBe(startupError)
      expect(report).toHaveBeenCalledWith('[mantad] startup cleanup failed:', cleanupError)
    } finally {
      report.mockRestore()
    }
  })

  it('coalesces concurrent and repeated normal stops', async () => {
    const cleanupRuntime = vi.fn(async () => {})
    const cleanupHost = vi.fn(async () => {})
    const handle = await startOrcadWithLifecycle(async (registerCleanup) => {
      registerCleanup(cleanupRuntime)
      return { readiness: 'ready' }
    }, cleanupHost)

    await Promise.all([handle.stop(), handle.stop()])
    await handle.stop()

    expect(cleanupRuntime).toHaveBeenCalledOnce()
    expect(cleanupHost).toHaveBeenCalledOnce()
  })
})
