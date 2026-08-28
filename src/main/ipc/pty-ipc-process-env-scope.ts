// Why: the pty IPC suites force darwin and rewrite a dozen agent-home env vars per test;
// this scope captures the real values once and puts them back afterwards.
export function createPtyIpcProcessEnvScope() {
  const savedOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
  const savedMantaOpenCodeConfigDir = process.env.MANTA_OPENCODE_CONFIG_DIR
  const savedMantaOpenCodeSourceConfigDir = process.env.MANTA_OPENCODE_SOURCE_CONFIG_DIR
  const savedPiAgentDir = process.env.PI_CODING_AGENT_DIR
  const savedMantaPiAgentDir = process.env.MANTA_PI_CODING_AGENT_DIR
  const savedMantaPiSourceAgentDir = process.env.MANTA_PI_SOURCE_AGENT_DIR
  const savedMantaCodexHome = process.env.MANTA_CODEX_HOME
  const savedMantaOmpAgentDir = process.env.MANTA_OMP_CODING_AGENT_DIR
  const savedMantaOmpSourceAgentDir = process.env.MANTA_OMP_SOURCE_AGENT_DIR
  const savedMantaOmpStatusExtension = process.env.MANTA_OMP_STATUS_EXTENSION
  const savedPrimeAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR
  const savedMantaPrimeAgentSourceDir = process.env.MANTA_PRIME_AGENT_SOURCE_AGENT_DIR
  const savedMantaPrimeAgentStatusExtension = process.env.MANTA_PRIME_AGENT_STATUS_EXTENSION
  const savedMantaClaudeAgentStatusSettings = process.env.MANTA_CLAUDE_AGENT_STATUS_SETTINGS
  const savedProcessPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const savedDisableMacosLoginShell = process.env.MANTA_DISABLE_MACOS_LOGIN_SHELL
  const savedMantaUserDataPath = process.env.MANTA_USER_DATA_PATH

  function applyTestEnvDefaults() {
    // Why: most PTY spawn tests assert POSIX shell behavior; Windows cases opt into win32 explicitly below.
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin'
    })
    // Why: forced darwin makes the TCC login(1) wrapper rewrite every asserted argv; its own test below re-enables it.
    process.env.MANTA_DISABLE_MACOS_LOGIN_SHELL = '1'
    delete process.env.OPENCODE_CONFIG_DIR
    delete process.env.MANTA_OPENCODE_SOURCE_CONFIG_DIR
    delete process.env.MANTA_OPENCODE_CONFIG_DIR
    delete process.env.MANTA_AGENT_HOOK_ENDPOINT
    delete process.env.MANTA_CLAUDE_AGENT_STATUS_SETTINGS
    delete process.env.PI_CODING_AGENT_DIR
    delete process.env.MANTA_PI_SOURCE_AGENT_DIR
    delete process.env.MANTA_PI_CODING_AGENT_DIR
    delete process.env.MANTA_CODEX_HOME
    delete process.env.MANTA_OMP_SOURCE_AGENT_DIR
    delete process.env.MANTA_OMP_CODING_AGENT_DIR
    delete process.env.MANTA_OMP_STATUS_EXTENSION
    delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    delete process.env.MANTA_PRIME_AGENT_SOURCE_AGENT_DIR
    delete process.env.MANTA_PRIME_AGENT_STATUS_EXTENSION
  }

  function restoreProcessEnv() {
    if (savedProcessPlatform) {
      Object.defineProperty(process, 'platform', savedProcessPlatform)
    }
    if (savedDisableMacosLoginShell !== undefined) {
      process.env.MANTA_DISABLE_MACOS_LOGIN_SHELL = savedDisableMacosLoginShell
    } else {
      delete process.env.MANTA_DISABLE_MACOS_LOGIN_SHELL
    }
    if (savedMantaUserDataPath !== undefined) {
      process.env.MANTA_USER_DATA_PATH = savedMantaUserDataPath
    } else {
      delete process.env.MANTA_USER_DATA_PATH
    }
    if (savedOpenCodeConfigDir !== undefined) {
      process.env.OPENCODE_CONFIG_DIR = savedOpenCodeConfigDir
    } else {
      delete process.env.OPENCODE_CONFIG_DIR
    }
    if (savedMantaOpenCodeConfigDir !== undefined) {
      process.env.MANTA_OPENCODE_CONFIG_DIR = savedMantaOpenCodeConfigDir
    } else {
      delete process.env.MANTA_OPENCODE_CONFIG_DIR
    }
    if (savedMantaOpenCodeSourceConfigDir !== undefined) {
      process.env.MANTA_OPENCODE_SOURCE_CONFIG_DIR = savedMantaOpenCodeSourceConfigDir
    } else {
      delete process.env.MANTA_OPENCODE_SOURCE_CONFIG_DIR
    }
    if (savedPiAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = savedPiAgentDir
    } else {
      delete process.env.PI_CODING_AGENT_DIR
    }
    if (savedMantaPiAgentDir !== undefined) {
      process.env.MANTA_PI_CODING_AGENT_DIR = savedMantaPiAgentDir
    } else {
      delete process.env.MANTA_PI_CODING_AGENT_DIR
    }
    if (savedMantaPiSourceAgentDir === undefined) {
      delete process.env.MANTA_PI_SOURCE_AGENT_DIR
    } else {
      process.env.MANTA_PI_SOURCE_AGENT_DIR = savedMantaPiSourceAgentDir
    }
    if (savedMantaCodexHome === undefined) {
      delete process.env.MANTA_CODEX_HOME
    } else {
      process.env.MANTA_CODEX_HOME = savedMantaCodexHome
    }
    if (savedMantaOmpAgentDir !== undefined) {
      process.env.MANTA_OMP_CODING_AGENT_DIR = savedMantaOmpAgentDir
    } else {
      delete process.env.MANTA_OMP_CODING_AGENT_DIR
    }
    if (savedMantaOmpSourceAgentDir !== undefined) {
      process.env.MANTA_OMP_SOURCE_AGENT_DIR = savedMantaOmpSourceAgentDir
    } else {
      delete process.env.MANTA_OMP_SOURCE_AGENT_DIR
    }
    if (savedMantaOmpStatusExtension !== undefined) {
      process.env.MANTA_OMP_STATUS_EXTENSION = savedMantaOmpStatusExtension
    } else {
      delete process.env.MANTA_OMP_STATUS_EXTENSION
    }
    if (savedPrimeAgentDir !== undefined) {
      process.env.PRIME_AGENT_CODING_AGENT_DIR = savedPrimeAgentDir
    } else {
      delete process.env.PRIME_AGENT_CODING_AGENT_DIR
    }
    if (savedMantaPrimeAgentSourceDir !== undefined) {
      process.env.MANTA_PRIME_AGENT_SOURCE_AGENT_DIR = savedMantaPrimeAgentSourceDir
    } else {
      delete process.env.MANTA_PRIME_AGENT_SOURCE_AGENT_DIR
    }
    if (savedMantaPrimeAgentStatusExtension !== undefined) {
      process.env.MANTA_PRIME_AGENT_STATUS_EXTENSION = savedMantaPrimeAgentStatusExtension
    } else {
      delete process.env.MANTA_PRIME_AGENT_STATUS_EXTENSION
    }
    if (savedMantaClaudeAgentStatusSettings === undefined) {
      delete process.env.MANTA_CLAUDE_AGENT_STATUS_SETTINGS
    } else {
      process.env.MANTA_CLAUDE_AGENT_STATUS_SETTINGS = savedMantaClaudeAgentStatusSettings
    }
  }

  return { applyTestEnvDefaults, restoreProcessEnv }
}
