import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  nativeStorage: new Map<string, string>(),
  deviceLocale: 'en-US',
  page: false,
  readPage: (_key: string): Promise<string | null> => Promise.resolve(null)
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) =>
      state.page ? state.readPage(key) : Promise.resolve(state.nativeStorage.get(key) ?? null),
    setItem: async (key: string, value: string) => {
      state.nativeStorage.set(key, value)
    }
  }
}))
vi.mock('../../i18n/device-locale', () => ({ getDeviceLocale: () => state.deviceLocale }))

const mounted: { renderer?: ReactTestRenderer } = {}

beforeEach(() => {
  vi.resetModules()
  state.nativeStorage.clear()
  state.page = false
})

afterEach(async () => {
  await act(async () => mounted.renderer?.unmount())
  mounted.renderer = undefined
})

describe('the native language choice in the workspace page', () => {
  it.each([
    { device: 'en-US', language: 'zh', expected: '语言' },
    { device: 'zh-CN', language: 'en', expected: 'Language' },
    { device: 'zh-CN', language: 'system', expected: '语言' }
  ] as const)('renders $language on a $device device from its first frame', async (choice) => {
    state.deviceLocale = choice.device
    const { writeUiLanguage } = await import('../../i18n/ui-language-store')
    const { readMirroredStorage } = await import('../../storage/mirrored-storage-keys')
    const { pageStorageKeysForHost } = await import('../page-storage-keys')
    const { default: pageStorage, publishPageStorage } = await import('./page-async-storage')

    await writeUiLanguage(choice.language)
    const snapshot = readMirroredStorage(pageStorageKeysForHost('host-1'))
    expect(snapshot['manta.ui-language']).toBe(choice.language)
    expect(state.nativeStorage.get('manta.ui-language')).toBe(choice.language)
    publishPageStorage(snapshot, () => false, 'host-1')
    state.readPage = pageStorage.getItem
    state.page = true

    const { I18nProvider } = await import('../../i18n/I18nProvider')
    const { translate } = await import('../../i18n/i18n')
    const frames: string[] = []
    function Probe() {
      const text = translate('mobile.settings.language.heading', 'Language')
      frames.push(text)
      return createElement('span', null, text)
    }
    await act(async () => {
      mounted.renderer = create(createElement(I18nProvider, null, createElement(Probe)))
    })
    expect(frames).toEqual([choice.expected])
    expect(mounted.renderer?.root.findByType('span').children).toEqual([choice.expected])
  })

  it('mounts the page client and readiness marker inside the language provider', () => {
    const entry = readFileSync(new URL('../../../web-entry/index.tsx', import.meta.url), 'utf8')
    const open = entry.indexOf('<I18nProvider>')
    const ready = entry.indexOf('<ReadyProviders>')
    expect(open).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(open)
    expect(ready).toBeLessThan(entry.indexOf('</I18nProvider>'))
    const providers = entry.slice(entry.indexOf('function ReadyProviders'), open)
    expect(providers).toContain("stampPageMountState(target, 'mounted')")
    expect(providers).toContain('<RpcClientProvider client={client}>')
  })
})
