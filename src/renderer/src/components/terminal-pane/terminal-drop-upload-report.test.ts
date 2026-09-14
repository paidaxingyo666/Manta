import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  formatTerminalDropUploadingMessage,
  reportTerminalDropUploadSkipsAndFailures
} from './terminal-drop-upload-report'

const mocks = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback: string) => `${key}:${fallback}`)
}))

vi.mock('sonner', () => ({
  toast: {
    message: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: mocks.translate
}))

describe('reportTerminalDropUploadSkipsAndFailures', () => {
  beforeEach(() => {
    mocks.translate.mockClear()
    vi.mocked(toast.message).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('uses distinct translation keys for symlink-only and mixed skipped uploads', () => {
    reportTerminalDropUploadSkipsAndFailures([{ reason: 'symlink' }], [])
    const symlinkOnlyKey = mocks.translate.mock.calls[0]?.[0]

    mocks.translate.mockClear()
    reportTerminalDropUploadSkipsAndFailures([{ reason: 'symlink' }, { reason: 'too_large' }], [])
    const mixedSkipKey = mocks.translate.mock.calls[0]?.[0]

    expect(symlinkOnlyKey).toBe(
      'auto.components.terminal.pane.terminal.drop.handler.53f015fd85_one'
    )
    expect(mixedSkipKey).toBe(
      'auto.components.terminal.pane.terminal.drop.handler.b4cf68e889_other'
    )
    expect(symlinkOnlyKey).not.toBe(mixedSkipKey)
    expect(toast.message).toHaveBeenCalledTimes(2)
  })

  it('reports upload failures without leaking individual paths', () => {
    reportTerminalDropUploadSkipsAndFailures([], [{ reason: '/secret/project/file.txt' }])

    expect(mocks.translate).toHaveBeenCalledWith(
      'auto.components.terminal.pane.terminal.drop.handler.1e072f611e_one',
      'Failed to upload {{value0}} file.',
      { value0: 1 }
    )
    expect(toast.error).toHaveBeenCalledWith(
      expect.not.stringContaining('/secret/project/file.txt')
    )
  })

  it('picks singular and plural uploading messages per destination', () => {
    expect(formatTerminalDropUploadingMessage(1, 'runtime')).toMatch(
      /e09913_one:Uploading \{\{value0\}\} file to runtime…$/
    )
    expect(formatTerminalDropUploadingMessage(3, 'runtime')).toMatch(
      /e09913_other:Uploading \{\{value0\}\} files to runtime…$/
    )
    expect(formatTerminalDropUploadingMessage(1, 'remote')).toMatch(
      /ac0575_one:Uploading \{\{value0\}\} file to remote…$/
    )
    expect(formatTerminalDropUploadingMessage(2, 'remote')).toMatch(
      /ac0575_other:Uploading \{\{value0\}\} files to remote…$/
    )
  })
})
