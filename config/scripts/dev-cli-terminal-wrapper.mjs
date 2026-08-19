import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function escapeWindowsBatchValue(value) {
  // Why: cmd.exe expands %NAME% even inside quotes, so literal path percent signs must be doubled.
  return value.replaceAll('%', '%%')
}

export function prepareDevCliTerminalWrappers({
  repoRoot,
  userDataPath,
  electronExecutable,
  platform = process.platform
}) {
  const binDir = path.join(repoRoot, 'out', 'bin')
  const userDataBinDir = path.join(userDataPath, 'cli', 'bin')
  const cliPath = path.join(repoRoot, 'out', 'cli', 'index.js')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(userDataBinDir, { recursive: true })

  if (platform === 'win32') {
    const wrapperContent = `@echo off\r\nset "MANTA_USER_DATA_PATH=${escapeWindowsBatchValue(userDataPath)}"\r\nset "MANTA_DEV_CLI_INVOCATION=1"\r\nset "MANTA_APP_EXECUTABLE=${escapeWindowsBatchValue(electronExecutable)}"\r\nset "MANTA_APP_EXECUTABLE_NEEDS_APP_ROOT=1"\r\nnode "${escapeWindowsBatchValue(cliPath)}" %*\r\n`
    for (const targetDir of [binDir, userDataBinDir]) {
      for (const commandName of ['manta-dev.cmd', 'manta.cmd']) {
        writeFileSync(path.join(targetDir, commandName), wrapperContent, 'utf8')
      }
    }
  } else {
    const wrapperContent = `#!/usr/bin/env bash\nexport MANTA_USER_DATA_PATH=${JSON.stringify(userDataPath)}\nexport MANTA_DEV_CLI_INVOCATION=1\nexport MANTA_APP_EXECUTABLE=${JSON.stringify(electronExecutable)}\nexport MANTA_APP_EXECUTABLE_NEEDS_APP_ROOT=1\nexec node ${JSON.stringify(cliPath)} "$@"\n`
    for (const targetDir of [binDir, userDataBinDir]) {
      for (const commandName of ['manta-dev', 'manta']) {
        const wrapperPath = path.join(targetDir, commandName)
        writeFileSync(wrapperPath, wrapperContent, 'utf8')
        chmodSync(wrapperPath, 0o755)
      }
    }
  }

  return { binDir, userDataBinDir }
}
