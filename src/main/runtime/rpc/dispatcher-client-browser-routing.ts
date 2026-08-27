import type { MantaRuntimeService } from '../manta-runtime'

export function routeDispatcherClientHostedBrowserRpc(
  runtime: MantaRuntimeService,
  method: string,
  params: unknown
) {
  const candidate = runtime as MantaRuntimeService & {
    routeClientHostedBrowserRpc?: MantaRuntimeService['routeClientHostedBrowserRpc']
  }
  return candidate.routeClientHostedBrowserRpc?.(method, params) ?? { handled: false as const }
}
