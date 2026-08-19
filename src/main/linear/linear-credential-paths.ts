import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LEGACY_WORKSPACE_ID = 'legacy'

function getMantaDir(): string {
  return join(homedir(), '.manta')
}

function getLegacyTokenPath(): string {
  return join(getMantaDir(), 'linear-token.enc')
}

export function getLegacyViewerPath(): string {
  return join(getMantaDir(), 'linear-viewer.json')
}

export function getWorkspaceFilePath(): string {
  return join(getMantaDir(), 'linear-workspaces.json')
}

function getWorkspaceTokenDir(): string {
  return join(getMantaDir(), 'linear-tokens')
}

export function getWorkspaceTokenPath(workspaceId: string): string {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    return getLegacyTokenPath()
  }
  return join(getWorkspaceTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.enc`)
}

export function ensureMantaDir(): void {
  const dir = getMantaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function ensureWorkspaceTokenDir(): void {
  const dir = getWorkspaceTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
