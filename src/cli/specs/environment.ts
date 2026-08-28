import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ENVIRONMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['host', 'list'],
    summary: 'List every machine this Manta host can target, and how to name each one',
    usage: 'manta host list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Answers "what can I target and what do I pass" in one place: this machine, the SSH targets registered on it, and the Manta servers paired with it.',
      'The three kinds are reached differently. A paired Manta server is a connection, selected with --environment <name>. An SSH target is a machine the connected Manta host reaches, selected with --host ssh:<id>. Passing one where the other belongs is the most common way to get an empty or missing-host answer.',
      "SSH targets are read from the Manta host you are currently connected to, so this lists that host's targets and not another server's."
    ],
    examples: ['manta host list', 'manta host list --json']
  },
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
