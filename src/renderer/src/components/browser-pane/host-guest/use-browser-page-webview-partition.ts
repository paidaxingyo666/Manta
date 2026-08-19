import { useAppStore } from '@/store'
import { MANTA_BROWSER_PARTITION } from '../../../../../shared/constants'
import { getMantaProfileBrowserDefaultPartition } from '../../../../../shared/manta-profiles'

export function useBrowserPageWebviewPartition({
  sessionProfileId,
  sessionPartition
}: {
  sessionProfileId: string | null
  sessionPartition: string | null
}): string {
  const browserSessionProfiles = useAppStore((s) => s.browserSessionProfiles)
  const activeMantaProfileId = useAppStore((s) => s.activeMantaProfileId)
  const fallbackBrowserPartition = activeMantaProfileId
    ? getMantaProfileBrowserDefaultPartition(activeMantaProfileId)
    : null
  const defaultSessionProfile = browserSessionProfiles.find((p) => p.id === 'default') ?? null
  const sessionProfile = sessionProfileId
    ? (browserSessionProfiles.find((p) => p.id === sessionProfileId) ?? null)
    : defaultSessionProfile
  return (
    sessionPartition ??
    sessionProfile?.partition ??
    defaultSessionProfile?.partition ??
    fallbackBrowserPartition ??
    MANTA_BROWSER_PARTITION
  )
}
