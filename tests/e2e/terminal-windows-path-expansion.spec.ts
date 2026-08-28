import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test as base } from './helpers/manta-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import { execInTerminal, waitForActivePanePtyId, waitForTerminalOutput } from './helpers/terminal'

const probeRoot = mkdtempSync(path.join(os.tmpdir(), 'manta-e2e-path-expansion-'))
const probeBin = path.join(probeRoot, 'bin')
mkdirSync(probeBin)
writeFileSync(
  path.join(probeBin, 'manta-path-expansion-probe.cmd'),
  '@echo off\r\necho MANTA_PATH_EXPANSION_OK\r\n'
)

const test = base
test.use({
  launchEnv: {
    MANTA_E2E_PATH_ROOT: probeRoot,
    PATH: `%MANTA_E2E_PATH_ROOT%\\bin${path.delimiter}${process.env.PATH ?? ''}`
  }
})

test.afterAll(() => {
  rmSync(probeRoot, { recursive: true, force: true })
})

test.skip(process.platform !== 'win32', 'Windows PATH expansion requires a native Windows shell')

test('expands variables in PATH before spawning a Windows shell', async ({ mantaPage }) => {
  await waitForSessionReady(mantaPage)
  await ensureTerminalVisible(mantaPage)
  const ptyId = await waitForActivePanePtyId(mantaPage)

  await execInTerminal(mantaPage, ptyId, 'manta-path-expansion-probe')

  await waitForTerminalOutput(mantaPage, 'MANTA_PATH_EXPANSION_OK')
})
