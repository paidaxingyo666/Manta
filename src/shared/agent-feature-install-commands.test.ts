import { describe, expect, it } from 'vitest'
import {
  buildAgentFeatureSkillInstallArgs,
  buildAgentFeatureSkillInstallCommand,
  MANTA_CLI_SKILL_INSTALL_COMMAND,
  buildAgentFeatureSkillUpdateArgs,
  buildAgentFeatureSkillUpdateCommand,
  COMPUTER_USE_SKILL_UPDATE_COMMAND,
  EPHEMERAL_VMS_SKILL_UPDATE_COMMAND,
  LINEAR_TICKETS_SKILL_UPDATE_COMMAND,
  MANTA_LINEAR_SKILL_UPDATE_COMMAND,
  MANTA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND,
  MANTA_CLI_SKILL_UPDATE_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND
} from './agent-feature-install-commands'

describe('agent feature skill commands', () => {
  it('builds a global install command by default', () => {
    expect(buildAgentFeatureSkillInstallCommand(['manta-cli'])).toBe(
      'npx skills add https://github.com/stablyai/manta --skill manta-cli --global'
    )
  })

  it('drops --global when installing locally', () => {
    expect(buildAgentFeatureSkillInstallCommand(['manta-cli'], { global: false })).toBe(
      'npx skills add https://github.com/stablyai/manta --skill manta-cli'
    )
  })

  it('repeats --skill per name for multi-skill installs', () => {
    expect(buildAgentFeatureSkillInstallCommand(['manta-cli', 'orchestration'])).toBe(
      'npx skills add https://github.com/stablyai/manta --skill manta-cli --skill orchestration --global'
    )
    expect(buildAgentFeatureSkillInstallArgs(['manta-cli', 'orchestration'])).toEqual([
      'skills',
      'add',
      'https://github.com/stablyai/manta',
      '--skill',
      'manta-cli',
      '--skill',
      'orchestration',
      '--global'
    ])
  })

  it('keeps the copyable Settings commands interactive by default', () => {
    // Why: -y skips the agent picker. A human pasting from Settings should still
    // get it; only an unattended spawn opts in.
    expect(buildAgentFeatureSkillInstallCommand(['manta-cli'])).not.toContain('-y')
    expect(buildAgentFeatureSkillUpdateCommand('manta-cli')).not.toContain('-y')
    expect(MANTA_CLI_SKILL_INSTALL_COMMAND).not.toContain('-y')
    expect(MANTA_CLI_SKILL_UPDATE_COMMAND).not.toContain('-y')
  })

  it('refuses to skip prompts without an install target', () => {
    // Why: -y with no --agent is the one combination that makes `skills add`
    // install into every agent it knows (~75). No caller may express it.
    expect(() => buildAgentFeatureSkillInstallCommand(['manta-cli'], { yes: true })).toThrow(
      'An install target is required when skipping prompts.'
    )
  })

  it('refuses a target the skills CLI would drop', () => {
    // Why: defence in depth behind the CLI's own check — the skills CLI silently
    // drops a `-`-leading --agent value, which empties its target list and
    // installs into every agent it knows.
    expect(() =>
      buildAgentFeatureSkillInstallCommand(['manta-cli'], { yes: true, agents: ['-y'] })
    ).toThrow('"-y" is not a usable install target.')
    expect(() =>
      buildAgentFeatureSkillInstallArgs(['manta-cli'], { yes: true, agents: ['universal', 'a b'] })
    ).toThrow('"a b" is not a usable install target.')
  })

  it('appends -y and the targets for an unattended run', () => {
    expect(
      buildAgentFeatureSkillInstallCommand(['manta-cli'], { yes: true, agents: ['universal'] })
    ).toBe(
      'npx skills add https://github.com/stablyai/manta --skill manta-cli --global --agent universal -y'
    )
    expect(buildAgentFeatureSkillUpdateCommand(['manta-cli'], { global: false, yes: true })).toBe(
      'npx skills update manta-cli --project -y'
    )
    expect(
      buildAgentFeatureSkillInstallArgs(['manta-cli'], { yes: true, agents: ['universal'] }).at(-1)
    ).toBe('-y')
    expect(buildAgentFeatureSkillUpdateArgs(['manta-cli'], { yes: true }).at(-1)).toBe('-y')
  })

  it('builds single-skill update commands', () => {
    expect(buildAgentFeatureSkillUpdateCommand('orchestration')).toBe(
      'npx skills update orchestration --global'
    )
  })

  it('trims and rejects blank update skill names', () => {
    expect(buildAgentFeatureSkillUpdateCommand('  manta-cli  ')).toBe(
      'npx skills update manta-cli --global'
    )
    expect(() => buildAgentFeatureSkillUpdateCommand('   ')).toThrow('A skill name is required.')
  })

  it('builds multi-skill update commands and selects project scope for --local', () => {
    expect(buildAgentFeatureSkillUpdateCommand(['manta-cli', 'orchestration'])).toBe(
      'npx skills update manta-cli orchestration --global'
    )
    expect(buildAgentFeatureSkillUpdateCommand(['manta-cli'], { global: false })).toBe(
      'npx skills update manta-cli --project'
    )
    expect(buildAgentFeatureSkillUpdateArgs(['manta-cli'], { global: false })).toEqual([
      'skills',
      'update',
      'manta-cli',
      '--project'
    ])
    expect(() => buildAgentFeatureSkillUpdateCommand([])).toThrow('A skill name is required.')
  })

  it('exports single-skill update constants without changing install bundles', () => {
    expect(MANTA_CLI_SKILL_UPDATE_COMMAND).toBe('npx skills update manta-cli --global')
    expect(COMPUTER_USE_SKILL_UPDATE_COMMAND).toBe('npx skills update computer-use --global')
    expect(ORCHESTRATION_SKILL_UPDATE_COMMAND).toBe('npx skills update orchestration --global')
    expect(EPHEMERAL_VMS_SKILL_UPDATE_COMMAND).toBe(
      'npx skills update manta-per-workspace-env --global'
    )
    expect(MANTA_LINEAR_SKILL_UPDATE_COMMAND).toBe('npx skills update manta-linear --global')
    expect(LINEAR_TICKETS_SKILL_UPDATE_COMMAND).toBe('npx skills update linear-tickets --global')
    expect(MANTA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND).toBe(
      buildAgentFeatureSkillInstallCommand(['manta-cli', 'orchestration'])
    )
  })
})
