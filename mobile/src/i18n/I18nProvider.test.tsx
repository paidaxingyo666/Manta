/**
 * Behavioural cover for the boot path: the stored preference has to be applied
 * before any screen renders, and a storage read that never answers must not
 * strand the app behind the splash screen.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = new Map<string, string>()
let readNeverResolves = false
let deviceLocale = 'en-US'

vi.mock('react-native', () => ({ Text: 'Text' }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) =>
      new Promise<string | null>((resolve) => {
        if (!readNeverResolves) {
          resolve(storage.get(key) ?? null)
        }
      }),
    setItem: async (key: string, value: string) => void storage.set(key, value)
  }
}))
vi.mock('./device-locale', () => ({ getDeviceLocale: () => deviceLocale }))

/** Calls translate() at mount, the way a real screen does. */
async function mountProbe(): Promise<ReactTestRenderer> {
  const { I18nProvider } = await import('./I18nProvider')
  const { translate } = await import('./i18n')
  const Probe = (): React.JSX.Element =>
    createElement('Text', null, translate('mobile.settings.language.heading', 'Language'))
  let tree: ReactTestRenderer | undefined
  await act(async () => {
    tree = create(createElement(I18nProvider, null, createElement(Probe)))
  })
  return tree!
}

function renderedText(tree: ReactTestRenderer): string | null {
  const found = tree.root.findAllByType('Text' as unknown as React.ComponentType)
  return found.length > 0 ? String(found[0]!.props.children) : null
}

describe('I18nProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    storage.clear()
    readNeverResolves = false
    // Default to a device that would otherwise boot the app in English.
    deviceLocale = 'en-US'
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the stored language, not the device one', async () => {
    storage.set('manta.ui-language', 'zh')
    expect(renderedText(await mountProbe())).toBe('语言')
  })

  it('honours an explicit English choice on a Chinese device', async () => {
    deviceLocale = 'zh-CN'
    storage.set('manta.ui-language', 'en')
    expect(renderedText(await mountProbe())).toBe('Language')
  })

  it('renders nothing until a language is settled', async () => {
    storage.set('manta.ui-language', 'zh')
    readNeverResolves = true
    expect(renderedText(await mountProbe())).toBeNull()
  })

  it('falls back to the device language rather than hanging on the splash', async () => {
    vi.useFakeTimers()
    storage.set('manta.ui-language', 'zh')
    readNeverResolves = true
    const tree = await mountProbe()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(renderedText(tree)).toBe('Language')
  })
})
