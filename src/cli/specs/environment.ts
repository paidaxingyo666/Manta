import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ENVIRONMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['environment', 'add'],
    summary: 'Save a remote Manta runtime environment from a pairing code',
    usage: 'manta environment add --name <name> --pairing-code <code> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    examples: ['manta environment add --name work-laptop --pairing-code manta://pair?code=...']
  },
  {
    path: ['environment', 'list'],
    summary: 'List saved Manta runtime environments',
    usage: 'manta environment list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['environment', 'show'],
    summary: 'Show one saved Manta runtime environment',
    usage: 'manta environment show --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['environment', 'rm'],
    destructive: true,
    summary: 'Remove one saved Manta runtime environment',
    usage: 'manta environment rm --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
