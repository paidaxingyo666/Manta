import { parseAppSshPtyId } from '../../../../../shared/ssh-pty-id'

import { isRemoteRuntimePtyId } from './paired-parked-terminal-restore'

// Why: hidden-output recovery for both remote shapes is answered across a link —
// paired runtimes ("remote:", host-owned buffer) and direct SSH
// ("ssh:<target>@@<id>", main's relay-fed model, whose serialize can block on
// host RPCs). A null/late snapshot from either is `unverifiable`, never proof
// the bytes are gone (docs/reference/ssh-execution-boundary.md).
export function isRemoteExecutionHostPtyId(ptyId: string | null | undefined): boolean {
  if (typeof ptyId !== 'string') {
    return false
  }
  return isRemoteRuntimePtyId(ptyId) || parseAppSshPtyId(ptyId) !== null
}
