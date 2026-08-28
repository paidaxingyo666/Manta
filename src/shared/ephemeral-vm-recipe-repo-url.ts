import { stripCredentialsFromMessage } from './git-remote-error'
import type { MantaVmRecipe } from './manta-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: MantaVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
