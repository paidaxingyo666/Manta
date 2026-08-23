import type { Platform } from './MobileHero'
import { translate } from '@/i18n/i18n'

// iOS ships two App Store tracks: the public App Store build (slower, ~weekly)
// and the TestFlight preview build (daily). Android only ships one APK track.
export type IosChannel = 'stable' | 'preview'

export type InstallCopy = { ctaLabel: string; url: string }

export const ANDROID_INSTALL_GUIDE_URL = 'https://www.manta.sh.cn/docs/android-apk'

// Why the releases page and not a store listing or a pinned asset: the App
// Store id and TestFlight invite inherited from upstream belong to upstream's
// app, so following them installs the wrong product — worse than a dead link,
// because it works. And this fork has published no mobile build yet, so a
// pinned `mobile-android-v0.0.44` asset is a 404. The releases page is true
// today (it is empty) and stays true the moment one is cut.
const FORK_RELEASES_URL = 'https://github.com/paidaxingyo666/Manta/releases'

const IOS_CHANNEL_COPY: Record<IosChannel, InstallCopy> = {
  stable: {
    ctaLabel: 'Open releases',
    url: FORK_RELEASES_URL
  },
  preview: {
    ctaLabel: 'Open releases',
    url: FORK_RELEASES_URL
  }
}

const ANDROID_COPY: InstallCopy = {
  ctaLabel: 'Open releases',
  url: FORK_RELEASES_URL
}

export function getInstallCopy(platform: Platform, iosChannel: IosChannel): InstallCopy {
  return platform === 'ios' ? IOS_CHANNEL_COPY[iosChannel] : ANDROID_COPY
}

export function getChannelTagline(iosChannel: IosChannel): string {
  return iosChannel === 'preview'
    ? translate(
        'auto.components.mobile.mobile.platform.copy.preview.tagline',
        'Newest features, updated daily.'
      )
    : translate(
        'auto.components.mobile.mobile.platform.copy.stable.tagline',
        'The public release, updated weekly.'
      )
}
