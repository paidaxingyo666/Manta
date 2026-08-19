import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const INTROSPECTION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent-context'],
    summary: 'Print the machine-readable command schema for agents',
    usage: 'manta agent-context [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Pure local read of the command registry — works without a running Manta app, so it is safe over SSH and in headless contexts.'
    ],
    examples: ['manta agent-context --json']
  }
]
