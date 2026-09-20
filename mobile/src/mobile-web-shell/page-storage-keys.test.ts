import { describe, expect, it } from 'vitest'
import {
  isPageStorageKey,
  isPageStorageKeyForHost,
  pageStorageKeysForHost,
  PAGE_STORAGE_MAX_KEY_CHARS
} from './page-storage-keys'

describe('the keys a page may read and write', () => {
  it('takes the list preferences and the native UI language', () => {
    expect(isPageStorageKey('manta:last-visited-worktree')).toBe(true)
    expect(isPageStorageKey('manta.ui-language')).toBe(true)
    expect(isPageStorageKey('manta:pins:host-1')).toBe(true)
  })

  it('refuses the rest of the namespace, including the flag that turns this on', () => {
    // Everything the app stores lives under `manta:`, so a page that could write any of it could
    // turn the hybrid shell on for a build that never offered it.
    for (const key of [
      'manta:mobileWebShellEnabled',
      'manta:remotePushHostRegistrations',
      'manta:pushServiceNotificationsEnabled',
      'manta:terminalTextScale',
      'manta:hosts'
    ]) {
      expect(isPageStorageKey(key), key).toBe(false)
    }
  })

  it('refuses the bare prefix, which names no host', () => {
    expect(isPageStorageKey('manta:pins:')).toBe(false)
  })

  it('refuses a key that only starts like an allowlisted one', () => {
    expect(isPageStorageKey('manta:last-visited-worktree:other')).toBe(false)
    expect(isPageStorageKey('not-manta:pins:host-1')).toBe(false)
  })

  it('refuses a key past the cap, whatever it starts with', () => {
    expect(isPageStorageKey(`manta:pins:${'h'.repeat(PAGE_STORAGE_MAX_KEY_CHARS)}`)).toBe(false)
  })

  it('names what the shell reads out of the app store for one host', () => {
    const keys = pageStorageKeysForHost('host-1')
    expect(keys).toEqual(['manta:last-visited-worktree', 'manta.ui-language', 'manta:pins:host-1'])
    for (const key of keys) {
      expect(isPageStorageKey(key), key).toBe(true)
    }
  })
})

describe('the allowlist narrowed to one host', () => {
  it('admits exactly the keys that host was handed', () => {
    for (const key of pageStorageKeysForHost('host-1')) {
      expect(isPageStorageKeyForHost(key, 'host-1'), key).toBe(true)
    }
  })

  it("refuses another host's pinned list, which the shape check alone admits", () => {
    expect(isPageStorageKey('manta:pins:host-2')).toBe(true)
    expect(isPageStorageKeyForHost('manta:pins:host-2', 'host-1')).toBe(false)
  })
})
