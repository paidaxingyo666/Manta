import { z } from 'zod'
import { prepareManagedWslCodexHomeBeforeShellLaunch } from '../../../codex/managed-wsl-home-shell-preflight'
import { defineMethod, type RpcMethod } from '../core'

const PrepareCodexForWslPaneParams = z
  .object({
    codexHome: z.string().max(4_096),
    mantaCodexHome: z.string().max(4_096),
    wslDistro: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^\\/\r\n]+$/)
  })
  .strict()

export const AGENT_HOOK_METHODS: readonly RpcMethod[] = [
  defineMethod({
    name: 'agentHooks.prepareCodexForWslPane',
    params: PrepareCodexForWslPaneParams,
    handler: async (params, { runtime, clientKind }) => {
      if (clientKind !== undefined) {
        throw new Error('Codex hook preparation is only available to the local Manta CLI.')
      }
      const settings = runtime.getClientSettings()
      return await prepareManagedWslCodexHomeBeforeShellLaunch({
        env: {
          CODEX_HOME: params.codexHome,
          MANTA_CODEX_HOME: params.mantaCodexHome,
          WSL_DISTRO_NAME: params.wslDistro
        },
        hooksEnabled:
          settings.agentStatusHooksEnabled && !settings.disabledTuiAgents.includes('codex')
      })
    }
  })
]
