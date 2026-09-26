import { MantadBindAddressError } from './mantad-bind-address'
import { OrcadBundledRuntimeError } from './orcad-bundled-runtime'
import { MantadInstanceLockError } from './mantad-instance-lock'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access'

export const MANTAD_EXIT_OK = 0
export const MANTAD_EXIT_FAILED = 1
export const MANTAD_EXIT_CONFIGURATION = 78

/** Configuration faults cannot be repaired by a supervisor restart. */
export function resolveMantadExitCode(error: unknown): number {
  return error instanceof MantadInstanceLockError ||
    error instanceof MantadBindAddressError ||
    error instanceof OrcadBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? MANTAD_EXIT_CONFIGURATION
    : MANTAD_EXIT_FAILED
}
