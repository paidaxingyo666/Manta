import type { PiAgentKind } from '../../shared/pi-agent-kind'

export const MANTA_PI_PREFILL_EXTENSION_FILE = 'manta-prefill.ts'

// Why: prefill-without-submit needs an env-var the bundled `manta-prefill.ts`
// extension can read on session_start. Each kind owns its own variable so an
// OMP PTY never honors a Pi draft (or vice versa).
type PrefillAgentKind = Exclude<PiAgentKind, 'prime-agent'>

const PREFILL_ENV_VAR_BY_KIND: Record<PrefillAgentKind, string> = {
  pi: 'MANTA_PI_PREFILL',
  omp: 'MANTA_OMP_PREFILL'
}

export function getPiPrefillExtensionSource(kind: PrefillAgentKind): string {
  const envVar = PREFILL_ENV_VAR_BY_KIND[kind]
  return [
    'export default function (pi) {',
    "  pi.on('session_start', async (event, ctx) => {",
    '    if (!process.env.MANTA_PANE_KEY) return',
    "    if (event.reason !== 'startup') return",
    `    const prefill = process.env.${envVar}`,
    '    if (!prefill) return',
    `    delete process.env.${envVar}`,
    '    try {',
    '      ctx.ui.setEditorText(prefill)',
    '    } catch {}',
    '  })',
    '}',
    ''
  ].join('\n')
}
