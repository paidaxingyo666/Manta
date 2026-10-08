import { ipcMain } from 'electron'
import type {
  OrcadManagedConversionResult,
  OrcadManagedPendingMigrationRow
} from '../../shared/mantad-managed-runtime'
import { listPendingManagedOrcadMigrations } from '../ssh/mantad-managed-migration-status'
import { convertSshTargetToManagedOrcad } from '../ssh/mantad-runtime-conversion'
import { conversionCollaborators } from '../ssh/mantad-runtime-conversion-wiring'
import { requiredString } from './mantad-runtime-lifecycle-handlers'

export function registerOrcadRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedOrcad',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<OrcadManagedConversionResult> => {
      const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
      return convertSshTargetToManagedOrcad(getUserDataPath(), {
        sshTargetId,
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators(sshTargetId)
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingOrcadMigrations',
    (): OrcadManagedPendingMigrationRow[] => listPendingManagedOrcadMigrations(getUserDataPath())
  )
}
