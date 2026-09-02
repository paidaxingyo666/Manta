import { describe, expect, it } from 'vitest'
import {
  buildLegacyAppImageCliWrapper,
  extractLegacyAppImageCliWrapperTarget
} from './legacy-appimage-cli-wrapper'

describe('legacy AppImage CLI wrapper', () => {
  it('recovers a path containing a newline', () => {
    const appImagePath = "/tmp/Manta\nnightly's.AppImage"
    expect(extractLegacyAppImageCliWrapperTarget(buildLegacyAppImageCliWrapper(appImagePath))).toBe(
      appImagePath
    )
  })

  it('rejects a wrapper with a changed command body', () => {
    const wrapper = buildLegacyAppImageCliWrapper('/tmp/Manta.AppImage')
    expect(
      extractLegacyAppImageCliWrapperTarget(wrapper.replace('set -euo pipefail', 'set -u'))
    ).toBe(null)
  })
})
