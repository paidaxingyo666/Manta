/** Builds and runs one hostile-host cell as a Docker sshd target for the relay deploy. */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '../../shared/child-process/run-process'
import type { SshTarget } from '../../shared/ssh-types'
import { shellEscape } from './ssh-connection-utils'
import { FORBIDDEN_TOOL_LOG, FORBIDDEN_TOOLS, type HostileHostCell } from './ssh-hostile-host-cells'
import type { HostileHostObserver } from './ssh-hostile-host-observer'

export type HostileHostTarget = {
  cell: HostileHostCell
  containerName: string
  networkName: string | null
  host: string
  port: number
  identityFile: string
  tempDir: string
}

async function run(program: string, args: readonly string[], timeoutMs = 60_000): Promise<string> {
  const result = await runProcess({ program, args, timeoutMs })
  if (result.code !== 0) {
    throw new Error(
      `${program} ${args.slice(0, 3).join(' ')} failed (${result.code ?? result.signal}): ${result.stderr || result.stdout}`
    )
  }
  return result.stdout.trim()
}

const FORBIDDEN_TOOL_SHIM = [
  '#!/bin/sh',
  `printf '%s %s\\n' "\${0##*/}" "$*" >> ${FORBIDDEN_TOOL_LOG}`,
  'exit 127',
  ''
].join('\n')

// Why an entrypoint: a noexec tmpfs home starts empty, so the key and modes are written at start.
const ENTRYPOINT = [
  '#!/bin/sh',
  'set -eu',
  'mkdir -p /root/.ssh /run/sshd',
  'chmod 700 /root /root/.ssh',
  `printf '%s\\n' "$AUTHORIZED_KEY" > /root/.ssh/authorized_keys`,
  'chmod 600 /root/.ssh/authorized_keys',
  'ssh-keygen -A >/dev/null',
  'exec /usr/sbin/sshd -D -e',
  ''
].join('\n')

export function hostileHostDockerfile(cell: HostileHostCell): string {
  const shims = FORBIDDEN_TOOLS.map((tool) => `ln -sf orca-forbidden-tool /usr/local/bin/${tool}`)
  return [
    ...cell.dockerfile,
    'COPY forbidden-tool.sh /usr/local/bin/orca-forbidden-tool',
    'COPY entrypoint.sh /orca-entrypoint.sh',
    [
      'RUN chmod 755 /usr/local/bin/orca-forbidden-tool /orca-entrypoint.sh',
      ...shims,
      // Why '*': sshd without PAM refuses key logins to a locked ('!') root account.
      "sed -i 's/^root:[^:]*:/root:*:/' /etc/shadow",
      // Why: pam_loginuid cannot write loginuid in an unprivileged container.
      "{ [ ! -f /etc/pam.d/sshd ] || sed -i 's/^session\\s*required\\s*pam_loginuid.so/session optional pam_loginuid.so/' /etc/pam.d/sshd; }"
    ].join(' && '),
    'CMD ["/orca-entrypoint.sh"]',
    ''
  ].join('\n')
}

async function buildImage(cell: HostileHostCell, contextDir: string): Promise<string> {
  await writeFile(join(contextDir, 'Dockerfile'), hostileHostDockerfile(cell))
  await writeFile(join(contextDir, 'forbidden-tool.sh'), FORBIDDEN_TOOL_SHIM)
  await writeFile(join(contextDir, 'entrypoint.sh'), ENTRYPOINT)
  const image = `manta-ssh-hostile-host:${cell.id}`
  await run('docker', ['build', '-q', '-t', image, contextDir], 900_000)
  return image
}

export async function startHostileHostTarget(cell: HostileHostCell): Promise<HostileHostTarget> {
  const tempDir = await mkdtemp(join(tmpdir(), `orca-hostile-${cell.id}-`))
  const identityFile = join(tempDir, 'id_ed25519')
  const containerName = `orca-hostile-${cell.id}-${randomUUID().slice(0, 8)}`
  let networkName: string | null = null
  try {
    await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-q', '-f', identityFile])
    const publicKey = (await readFile(`${identityFile}.pub`, 'utf8')).trim()
    const contextDir = join(tempDir, 'image')
    await mkdir(contextDir)
    const image = await buildImage(cell, contextDir)
    const args = ['run', '-d', '--name', containerName, '-e', `AUTHORIZED_KEY=${publicKey}`]
    if (cell.homeNoexec) {
      args.push('--tmpfs', '/root:rw,noexec,nosuid,mode=700')
    }
    if (cell.noEgress) {
      networkName = `${containerName}-internal`
      await run('docker', ['network', 'create', '--internal', networkName])
      args.push('--network', networkName)
    } else {
      args.push('-p', '127.0.0.1::22')
    }
    await run('docker', [...args, image])
    const target = cell.noEgress
      ? {
          // Why the bridge address: an internal network publishes no ports, but the Linux host
          // shares that bridge and reaches the container directly.
          host: await run('docker', [
            'inspect',
            '-f',
            '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
            containerName
          ]),
          port: 22
        }
      : {
          host: '127.0.0.1',
          port: Number((await run('docker', ['port', containerName, '22/tcp'])).split(':').at(-1))
        }
    const started: HostileHostTarget = {
      cell,
      containerName,
      networkName,
      identityFile,
      tempDir,
      ...target
    }
    await waitForSshd(started)
    return started
  } catch (error) {
    await removeContainer(containerName, networkName)
    await rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

async function waitForSshd(target: HostileHostTarget): Promise<void> {
  const deadline = Date.now() + 60_000
  let last = ''
  while (Date.now() < deadline) {
    const result = await runProcess({
      program: 'ssh',
      args: [
        '-i',
        target.identityFile,
        '-p',
        String(target.port),
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=/dev/null',
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'ConnectTimeout=5',
        `root@${target.host}`,
        'true'
      ],
      timeoutMs: 15_000
    })
    if (result.code === 0) {
      return
    }
    last = result.stderr || result.stdout
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  const logs = await runProcess({ program: 'docker', args: ['logs', target.containerName] })
  throw new Error(`sshd in ${target.cell.id} never accepted the key: ${last}\n${logs.stderr}`)
}

async function removeContainer(containerName: string, networkName: string | null): Promise<void> {
  await runProcess({ program: 'docker', args: ['rm', '-f', containerName], timeoutMs: 60_000 })
  if (networkName) {
    await runProcess({ program: 'docker', args: ['network', 'rm', networkName], timeoutMs: 30_000 })
  }
}

export async function stopHostileHostTarget(target: HostileHostTarget | null): Promise<void> {
  if (!target) {
    return
  }
  await removeContainer(target.containerName, target.networkName)
  await rm(target.tempDir, { recursive: true, force: true })
}

/** Runs a POSIX sh command inside the container, outside SSH, as the test's own observer. */
export function hostExec(target: HostileHostTarget, command: string): Promise<string> {
  return run('docker', ['exec', target.containerName, 'sh', '-c', command], 120_000)
}

/** Exit status only: for probes whose failure is the expected answer. */
export async function hostExecStatus(target: HostileHostTarget, command: string): Promise<number> {
  const result = await runProcess({
    program: 'docker',
    args: ['exec', target.containerName, 'sh', '-c', command],
    timeoutMs: 60_000
  })
  return result.code ?? -1
}

/** Observes the container as root through `docker exec`, never through the SSH session under test. */
export function dockerHostObserver(target: HostileHostTarget): HostileHostObserver {
  return {
    readForbiddenToolLog: () => hostExec(target, `cat ${FORBIDDEN_TOOL_LOG} 2>/dev/null || true`),
    plantIdleRuntime: async (storeDir, name, age) => {
      const dir = `${storeDir}/${name}`
      const stamp = age === 'old' ? '-t 200001010000 ' : ''
      await hostExec(
        target,
        `mkdir -p ${shellEscape(`${dir}/bin`)} && touch ${stamp}${shellEscape(`${dir}/.verified`)}`
      )
    },
    exists: async (path) => (await hostExecStatus(target, `test -e ${shellEscape(path)}`)) === 0,
    isFile: async (path) => (await hostExecStatus(target, `test -f ${shellEscape(path)}`)) === 0,
    fileStamp: (path) => hostExec(target, `stat -c '%i:%Y' ${shellEscape(path)}`),
    fileSha256: async (path) =>
      (await hostExec(target, `sha256sum ${shellEscape(path)}`)).split(/\s+/)[0]
  }
}

export function hostileHostSshTarget(target: HostileHostTarget): SshTarget {
  return {
    id: `hostile-${target.cell.id}-${randomUUID()}`,
    label: `Hostile host ${target.cell.id}`,
    source: 'manual',
    host: target.host,
    port: target.port,
    username: 'root',
    identityFile: target.identityFile,
    identitiesOnly: true,
    remoteRuntime: 'pinned-node'
  }
}
