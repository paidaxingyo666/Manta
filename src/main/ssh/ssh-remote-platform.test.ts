import { describe, expect, it } from 'vitest'
import {
  assertSafeRemotePathSegment,
  getRemoteHostPlatform,
  joinRemotePath
} from './ssh-remote-platform'

describe('joinRemotePath', () => {
  it('joins POSIX remote paths', () => {
    expect(joinRemotePath(getRemoteHostPlatform('linux-x64'), '/home/me', '.manta-remote')).toBe(
      '/home/me/.manta-remote'
    )
  })

  it('normalizes and joins Windows remote paths with forward slashes for SFTP and Node', () => {
    expect(
      joinRemotePath(getRemoteHostPlatform('win32-x64'), 'C:\\Users\\me', '.manta-remote', 'relay')
    ).toBe('C:/Users/me/.manta-remote/relay')
  })
})

describe('assertSafeRemotePathSegment', () => {
  it('accepts ordinary names under both path flavors', () => {
    expect(() => assertSafeRemotePathSegment('report copy.txt', 'posix')).not.toThrow()
    expect(() => assertSafeRemotePathSegment('report copy.txt', 'windows')).not.toThrow()
  })

  it.each(['.', '..', '../secret', 'child/name', 'nul\0byte'])(
    'rejects invalid segment %j under both path flavors',
    (segment) => {
      expect(() => assertSafeRemotePathSegment(segment, 'posix')).toThrow(
        'Unsafe remote path segment'
      )
      expect(() => assertSafeRemotePathSegment(segment, 'windows')).toThrow(
        'Unsafe remote path segment'
      )
    }
  )

  it('preserves valid POSIX names that Windows would reinterpret', () => {
    expect(() => assertSafeRemotePathSegment('notes\\2026\nfinal.txt', 'posix')).not.toThrow()
  })

  it.each([
    '..\\..\\.ssh\\manta_drop',
    'report.txt:manta',
    'question?.txt',
    'trailing.',
    'trailing ',
    'NUL',
    'con.txt',
    'CONIN$',
    'CLOCK$.log',
    'COM1.log',
    'LPT¹'
  ])('rejects Win32-special segment %j', (segment) => {
    expect(() => assertSafeRemotePathSegment(segment, 'windows')).toThrow(
      'Unsafe remote path segment'
    )
  })
})
