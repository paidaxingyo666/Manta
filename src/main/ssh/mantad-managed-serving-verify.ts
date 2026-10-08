import { resolveEnvironment } from '../../shared/runtime-environment-store'
import type { OrcadManagedServing } from './mantad-managed-serving'
import { verifyManagedTunnelServing } from './mantad-managed-tunnel'

/** After the tunnel: the server answers, or was proven stopped and started; never throws. */
export function verifyOrcadManagedServing(
  userDataPath: string,
  selector: string
): Promise<OrcadManagedServing> {
  return Promise.resolve()
    .then(() => verifyManagedTunnelServing(resolveEnvironment(userDataPath, selector)))
    .catch((error: unknown) => ({ state: 'unverifiable', detail: String(error) }))
}
