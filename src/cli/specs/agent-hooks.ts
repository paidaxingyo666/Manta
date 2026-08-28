import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: 'Repair Manta-managed Codex hook trust before a shell launch',
    usage: 'manta agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Manta-managed agent status hooks are enabled',
    usage: 'manta agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['manta agent hooks status', 'manta agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Manta-managed agent status hooks and remove local hook entries',
    usage: 'manta agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['manta agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Manta-managed agent status hooks',
    usage: 'manta agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['manta agent hooks on']
  }
]
