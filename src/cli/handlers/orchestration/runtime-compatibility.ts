import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'manta' | 'manta-ide' | 'manta-dev' {
  const configured = process.env.MANTA_CLI_COMMAND
  if (configured === 'manta' || configured === 'manta-ide' || configured === 'manta-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'manta-ide' : 'manta'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'manta' | 'manta-ide' | undefined {
  if (process.env.MANTA_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.MANTA_CLI_COMMAND
  if (command === 'manta' || command === 'manta-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Manta launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.MANTA_DEV_CLI_INVOCATION === '1' ||
    (process.env.MANTA_USER_DATA_PATH?.includes('manta-dev') ?? false)
  )
}
