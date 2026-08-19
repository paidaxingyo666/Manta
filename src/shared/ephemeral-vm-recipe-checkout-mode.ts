import { getEphemeralVmRecipeResultCheckoutMode } from './ephemeral-vm-recipes'
import type { EphemeralVmRecipeResult } from './ephemeral-vm-recipes'
import type { MantaVmRecipe } from './manta-yaml-hook-types'

export function getEphemeralVmRecipeResultSchemaVersion(recipe: MantaVmRecipe): 1 | 2 {
  return recipe.checkoutMode === 'provisioned-root' ? 2 : 1
}

export function getEphemeralVmRecipeCheckoutModeError(
  recipe: MantaVmRecipe,
  result: EphemeralVmRecipeResult
): string | null {
  const configuredMode = recipe.checkoutMode ?? 'manta-worktree'
  const resultMode = getEphemeralVmRecipeResultCheckoutMode(result)
  if (configuredMode === resultMode) {
    return null
  }
  return configuredMode === 'provisioned-root'
    ? 'Provisioned-root recipes must return schemaVersion 2 with checkoutMode "provisioned-root".'
    : 'Recipe result requests provisioned-root checkout, but the recipe is not configured for it.'
}
