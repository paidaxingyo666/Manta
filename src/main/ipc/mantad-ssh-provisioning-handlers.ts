import { ipcMain } from 'electron'
import type { OrcadSshProvisioningRequest } from '../../shared/mantad-ssh-provisioning'
import {
  createOrcadSshHost,
  listPendingOrcadSshProvisioning,
  resumeOrcadSshHost
} from '../ssh/mantad-ssh-provisioning'

export function registerOrcadSshProvisioningHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:createOrcadSshHost',
    (_event, args: OrcadSshProvisioningRequest) => createOrcadSshHost(getUserDataPath(), args)
  )
  ipcMain.handle('runtimeEnvironments:resumeOrcadSshHost', (_event, args: { requestId: string }) =>
    resumeOrcadSshHost(getUserDataPath(), args?.requestId)
  )
  ipcMain.handle('runtimeEnvironments:listPendingOrcadSshProvisioning', () =>
    listPendingOrcadSshProvisioning(getUserDataPath())
  )
}
