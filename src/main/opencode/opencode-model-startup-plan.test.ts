import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAgentStartupPlanInputs } from '../../shared/agent-startup-plan-inputs'
import { probeOpenCodeLaunchCapabilities } from './opencode-launch-capabilities'
import {
  probeOpenCodeModelAvailability,
  resolveOpenCodeDirectModelExecutable
} from './opencode-model-availability'
import { buildExecutionHostAgentStartupPlan } from './opencode-model-startup-plan'

vi.mock('../managed-data-accounts/launch-environment', () => ({
  applyManagedDataAccountEnvironment: vi.fn()
}))
vi.mock('./opencode-launch-capabilities', () => ({ probeOpenCodeLaunchCapabilities: vi.fn() }))
vi.mock('./opencode-model-availability', () => ({
  probeOpenCodeModelAvailability: vi.fn(),
  resolveOpenCodeDirectModelExecutable: vi.fn()
}))

function scope() {
  return {
    inputs: resolveAgentStartupPlanInputs({
      agent: 'opencode',
      settings: { agentCmdOverrides: {} },
      platform: process.platform,
      isRemote: false,
      sessionOptions: { model: 'private-proof/model-b' }
    }),
    cwd: '/private/project',
    prompt: 'Read only',
    hostIdentity: 'host'
  }
}

describe('verified legacy execution-host model startup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(resolveOpenCodeDirectModelExecutable).mockResolvedValue('/resolved/opencode')
    vi.mocked(probeOpenCodeModelAvailability).mockResolvedValue(true)
    vi.mocked(probeOpenCodeLaunchCapabilities).mockResolvedValue({
      version: '1.18.30',
      pluginApi: 'v1',
      promptMode: 'submit'
    })
  })

  it.each(['1.18.30', '1.18.32'])(
    'verifies the default executable and exact model on %s',
    async (version) => {
      vi.mocked(probeOpenCodeLaunchCapabilities).mockResolvedValue({
        version,
        pluginApi: 'v1',
        promptMode: 'submit'
      })
      const plan = await buildExecutionHostAgentStartupPlan(scope())
      expect(plan?.launchCommand).toContain('--model')
      expect(resolveOpenCodeDirectModelExecutable).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'opencode' })
      )
      expect(probeOpenCodeModelAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'opencode',
          model: 'private-proof/model-b',
          cwd: '/private/project'
        })
      )
    }
  )

  it('refuses a missing model even when the CLI could silently use its default', async () => {
    vi.mocked(probeOpenCodeModelAvailability).mockResolvedValue(false)
    await expect(buildExecutionHostAgentStartupPlan(scope())).rejects.toMatchObject({
      code: 'capability_unsupported'
    })
  })

  it.each(['1.18.31', '2.0.16', '9.0.0'])(
    'refuses unverified legacy support for %s',
    async (version) => {
      vi.mocked(probeOpenCodeLaunchCapabilities).mockResolvedValue({
        version,
        pluginApi: 'v1',
        promptMode: 'submit'
      })
      await expect(buildExecutionHostAgentStartupPlan(scope())).rejects.toMatchObject({
        code: 'capability_unsupported'
      })
      expect(probeOpenCodeModelAvailability).not.toHaveBeenCalled()
    }
  )

  it('refuses remote, WSL, and extra preferences before a local probe', async () => {
    const options = scope()
    options.inputs.isRemote = true
    await expect(buildExecutionHostAgentStartupPlan(options)).rejects.toMatchObject({
      code: 'capability_unsupported'
    })
    options.inputs.isRemote = false
    await expect(
      buildExecutionHostAgentStartupPlan({ ...options, isWsl: true })
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
    options.inputs.sessionOptions = { model: 'private-proof/model-b', effort: 'high' }
    await expect(buildExecutionHostAgentStartupPlan(options)).rejects.toMatchObject({
      code: 'capability_unsupported'
    })
    expect(resolveOpenCodeDirectModelExecutable).not.toHaveBeenCalled()
  })

  it('preserves an ordinary launch without probing or overriding its own model', async () => {
    const options = scope()
    options.inputs.sessionOptions = undefined
    expect((await buildExecutionHostAgentStartupPlan(options))?.launchCommand).not.toContain(
      '--model'
    )
    expect(probeOpenCodeLaunchCapabilities).not.toHaveBeenCalled()
  })
})
