import type { AgentStartupPlanInputs } from '../../shared/agent-startup-plan-inputs'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from '../../shared/tui-agent-startup'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import type { TuiAgent } from '../../shared/tui-agent'
import { isVerifiedOpenCodeLegacyModelVersion } from './opencode-model-version-policy'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { applyManagedDataAccountEnvironment } from '../managed-data-accounts/launch-environment'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { probeOpenCodeLaunchCapabilities } from './opencode-launch-capabilities'
import {
  probeOpenCodeModelAvailability,
  resolveOpenCodeDirectModelExecutable
} from './opencode-model-availability'

type StartupScope = {
  inputs: AgentStartupPlanInputs
  cwd: string
  isWsl?: boolean
  hostIdentity?: string
  signal?: AbortSignal
}

function refuseModel(): never {
  throw new OrchestrationError(
    'capability_unsupported',
    'The execution host cannot verify this OpenCode model launch.'
  )
}

export async function prepareOpenCodeModelStartupInputs(
  options: StartupScope
): Promise<{ inputs: AgentStartupPlanInputs; launchConfig?: SleepingAgentLaunchConfig }> {
  const { inputs } = options
  const model = inputs.sessionOptions?.model
  if (
    inputs.agent !== 'opencode' ||
    !Object.values(inputs.sessionOptions ?? {}).some((value) => value !== undefined)
  ) {
    return { inputs }
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    refuseModel()
  }
  if (
    Object.entries(inputs.sessionOptions ?? {}).some(
      ([key, value]) => key !== 'model' && value !== undefined
    ) ||
    inputs.isRemote ||
    options.isWsl ||
    inputs.platform !== process.platform ||
    options.signal?.aborted
  ) {
    refuseModel()
  }
  const command =
    inputs.cmdOverrides.opencode ||
    getTuiAgentLaunchCommand(TUI_AGENT_CONFIG.opencode, inputs.platform)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...inputs.agentEnv })) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  applyManagedDataAccountEnvironment(env, { launchAgent: 'opencode' })
  const executable = await resolveOpenCodeDirectModelExecutable({
    command,
    model,
    cwd: options.cwd,
    env
  })
  if (!executable) {
    refuseModel()
  }
  const capabilities = await probeOpenCodeLaunchCapabilities({
    command,
    agent: 'opencode',
    cwd: options.cwd,
    env,
    hostIdentity: options.hostIdentity
  })
  if (isVerifiedOpenCodeLegacyModelVersion(capabilities?.version)) {
    if (!(await probeOpenCodeModelAvailability({ command, model, cwd: options.cwd, env }))) {
      refuseModel()
    }
    return { inputs }
  }
  refuseModel()
}

export async function buildExecutionHostAgentStartupPlan(
  options: StartupScope & {
    prompt: string
    promptDelivery?: 'auto-submit' | 'draft'
  }
) {
  const prepared = await prepareOpenCodeModelStartupInputs(options)
  if (prepared.launchConfig && options.promptDelivery === 'draft') {
    refuseModel()
  }
  const plan =
    options.promptDelivery === 'draft'
      ? buildAgentDraftLaunchPlan({ ...prepared.inputs, draft: options.prompt })
      : buildAgentStartupPlan({
          ...prepared.inputs,
          prompt: options.prompt,
          allowEmptyPromptLaunch: true
        })
  if (plan && prepared.launchConfig) {
    plan.launchConfig = prepared.launchConfig
    plan.sessionOptions = { ...options.inputs.sessionOptions }
  }
  return plan
}

export function assertOpenCodeModelLaunchPreferencesAbsent(
  agent: TuiAgent | undefined,
  preferences: Readonly<Record<string, unknown>> | undefined
): void {
  if (
    agent === 'opencode' &&
    Object.values(preferences ?? {}).some((value) => value !== undefined)
  ) {
    refuseModel()
  }
}
