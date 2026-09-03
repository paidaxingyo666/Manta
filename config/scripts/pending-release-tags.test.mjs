import { describe, expect, it } from 'vitest'

import { pendingReleaseTags } from './pending-release-tags.mjs'

const none = () => false
const all = () => true

describe('pending release tags', () => {
  const steady = {
    desktop: '1.4.196-rc.0',
    previousDesktop: '1.4.196-rc.0',
    mobile: '0.0.44',
    previousMobile: '0.0.44'
  }

  it('tags nothing when a push changed no version', () => {
    // The common case by far: an ordinary PR merging into main.
    expect(pendingReleaseTags(steady, none)).toEqual([])
  })

  it('does not tag an untagged version the push did not touch', () => {
    // The fork sat at mobile 0.0.44 for months without ever shipping a mobile
    // release. Standing still is not a release, and tagging one on the next
    // unrelated merge would ship a build nobody asked for.
    expect(pendingReleaseTags(steady, none)).toEqual([])
  })

  it('tags the desktop release when package.json moved', () => {
    expect(pendingReleaseTags({ ...steady, previousDesktop: '1.4.193-rc.0' }, none)).toEqual([
      'v1.4.196-rc.0'
    ])
  })

  it('tags both mobile platforms from the one version they share', () => {
    expect(pendingReleaseTags({ ...steady, previousMobile: '0.0.43' }, none)).toEqual([
      'mobile-ios-v0.0.44',
      'mobile-android-v0.0.44'
    ])
  })

  it('tags desktop and mobile together when a sync moved both', () => {
    expect(
      pendingReleaseTags(
        {
          desktop: '1.4.196-rc.0',
          previousDesktop: '1.4.193-rc.0',
          mobile: '0.0.47',
          previousMobile: '0.0.44'
        },
        none
      )
    ).toEqual(['v1.4.196-rc.0', 'mobile-ios-v0.0.47', 'mobile-android-v0.0.47'])
  })

  it('skips a tag that already exists', () => {
    // A re-run of the workflow, or a tag pushed by hand before the job caught up.
    expect(pendingReleaseTags({ ...steady, previousDesktop: '1.4.193-rc.0' }, all)).toEqual([])
  })

  it('tags one mobile platform when only the other is already tagged', () => {
    const tagged = (name) => name === 'mobile-ios-v0.0.44'
    expect(pendingReleaseTags({ ...steady, previousMobile: '0.0.43' }, tagged)).toEqual([
      'mobile-android-v0.0.44'
    ])
  })

  it('treats an unreadable baseline as changed', () => {
    // First push, or a shallow fetch: silence would mean a release never ships.
    expect(
      pendingReleaseTags({ ...steady, previousDesktop: null, previousMobile: null }, none)
    ).toEqual(['v1.4.196-rc.0', 'mobile-ios-v0.0.44', 'mobile-android-v0.0.44'])
  })

  it('refuses a version that is not release-shaped', () => {
    // A hand-edited manifest must not become the tag electron-updater compares.
    expect(() =>
      pendingReleaseTags(
        { ...steady, desktop: '1.4.196-beta', previousDesktop: '1.4.193-rc.0' },
        none
      )
    ).toThrow(/not X\.Y\.Z/)
    expect(() =>
      pendingReleaseTags({ ...steady, mobile: '0.0.44-rc.1', previousMobile: '0.0.43' }, none)
    ).toThrow(/not X\.Y\.Z/)
  })
})
