import type { SkillInstallDestination } from '../../shared/skill-install-contract'
import type { MantaRuntimeService } from '../runtime/manta-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: MantaRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
