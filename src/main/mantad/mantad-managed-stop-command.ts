/**
 * `mantad --complete-managed-stop <request-json>`: one stop, one JSON verdict line on stdout.
 *
 * Exit 0 means a verdict was printed — read it, the exit code does not carry it. 64 is a
 * malformed invocation; 1 is a failure before any verdict, which is never evidence of exit.
 */
import {
  ORCAD_COMPLETE_MANAGED_STOP_FLAG,
  OrcadManagedStopRequestSchema,
  type OrcadManagedStopCompletion
} from '../../shared/orcad-stop-request'
import { ZodError } from 'zod'
import {
  completeOrcadManagedStop,
  type OrcadManagedStopCompletionOptions
} from './orcad-managed-stop-completion'

export async function runOrcadManagedStopCommand(
  argv: readonly string[],
  options: OrcadManagedStopCompletionOptions = {}
): Promise<OrcadManagedStopCompletion> {
  if (argv.length !== 2 || argv[0] !== ORCAD_COMPLETE_MANAGED_STOP_FLAG || !argv[1]) {
    throw new Error('orcad_managed_stop_invalid_arguments')
  }
  const request = OrcadManagedStopRequestSchema.parse(JSON.parse(argv[1]))
  const verdict = await completeOrcadManagedStop(request, options)
  const completion: OrcadManagedStopCompletion = {
    ...request,
    kind: 'orcad_managed_stop_completion',
    verdict,
    receiptPersisted: verdict === 'exited'
  }
  process.stdout.write(`${JSON.stringify(completion)}\n`)
  return completion
}

export const ORCAD_MANAGED_STOP_EXIT_VERDICT = 0
export const ORCAD_MANAGED_STOP_EXIT_FAILED = 1
export const ORCAD_MANAGED_STOP_EXIT_USAGE = 64

export async function runOrcadManagedStopCommandAndExit(argv: readonly string[]): Promise<void> {
  let code = ORCAD_MANAGED_STOP_EXIT_VERDICT
  try {
    await runOrcadManagedStopCommand(argv)
  } catch (error) {
    console.error('mantad: managed stop failed:', error)
    code =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'orcad_managed_stop_invalid_arguments')
        ? ORCAD_MANAGED_STOP_EXIT_USAGE
        : ORCAD_MANAGED_STOP_EXIT_FAILED
  }
  // Why exit after the write drains: the caller reads stdout to EOF.
  process.stdout.write('', () => process.exit(code))
}
