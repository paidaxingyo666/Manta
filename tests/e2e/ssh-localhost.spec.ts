import os from 'node:os'

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/manta-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  UUID_RE,
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

type LocalhostSshTarget = {
  label: string
  host: string
  port: number
  username: string
  configHost?: string
  identityFile?: string
}

const RUN_LOCALHOST_SSH = process.env.MANTA_E2E_SSH_LOCALHOST === '1'
const RUN_REMOTE_HOOKS =
  process.env.MANTA_FEATURE_REMOTE_AGENT_HOOKS === undefined ||
  (process.env.MANTA_FEATURE_REMOTE_AGENT_HOOKS.trim() !== '' &&
    process.env.MANTA_FEATURE_REMOTE_AGENT_HOOKS.trim() !== '0')

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '22')
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }
  throw new Error(`Invalid MANTA_E2E_SSH_PORT: ${value}`)
}

function currentUsername(): string {
  return (
    process.env.MANTA_E2E_SSH_USER ??
    process.env.USER ??
    process.env.USERNAME ??
    os.userInfo().username
  )
}

function readLocalhostSshTarget(): LocalhostSshTarget {
  const configHost = process.env.MANTA_E2E_SSH_CONFIG_HOST?.trim()
  const host = process.env.MANTA_E2E_SSH_HOST?.trim() ?? (configHost ? '' : '127.0.0.1')
  const identityFile = process.env.MANTA_E2E_SSH_IDENTITY_FILE?.trim()

  return {
    label: `Localhost SSH E2E ${Date.now()}`,
    host,
    port: parsePort(process.env.MANTA_E2E_SSH_PORT),
    username: currentUsername(),
    ...(configHost ? { configHost } : {}),
    ...(identityFile ? { identityFile } : {})
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function marker(name: string): string {
  return `__MANTA_${name}_${Date.now()}__`
}

function emitMarkerCommand(value: string): string {
  const midpoint = Math.floor(value.length / 2)
  return `printf '%s%s\\n' ${shellQuote(value.slice(0, midpoint))} ${shellQuote(
    value.slice(midpoint)
  )}`
}

async function focusTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      throw new Error('No active worktree')
    }
    const tabId =
      state.activeTabType === 'terminal'
        ? state.activeTabId
        : (state.activeTabIdByWorktree?.[worktreeId] ?? null)
    if (!tabId) {
      throw new Error('No active terminal tab')
    }
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    if (!pane) {
      throw new Error('No active terminal pane')
    }
    pane.terminal.focus()
  })
}

async function postCodexHook(
  page: Page,
  ptyId: string,
  payload: Record<string, unknown>,
  markerName: string
): Promise<void> {
  const hookPostedMarker = marker(markerName)
  // Why: a foreground curl command emits the shell's command-finished marker
  // immediately after the hook, which correctly clears a same-turn agent row.
  // Post from a delayed background subshell so this test observes hook routing.
  await execInTerminal(
    page,
    ptyId,
    [
      'if [ -z "$MANTA_AGENT_HOOK_PORT" ] || [ -z "$MANTA_AGENT_HOOK_TOKEN" ] || [ -z "$MANTA_PANE_KEY" ]; then',
      '  echo __MANTA_AGENT_HOOK_ENV_MISSING__',
      'else',
      `  hook_payload=${shellQuote(JSON.stringify(payload))}`,
      '  (',
      '    sleep 0.1',
      '    if curl -sS -X POST "http://127.0.0.1:${MANTA_AGENT_HOOK_PORT}/hook/codex" \\',
      '      -H "Content-Type: application/x-www-form-urlencoded" \\',
      '      -H "X-Manta-Agent-Hook-Token: ${MANTA_AGENT_HOOK_TOKEN}" \\',
      '      --data-urlencode "paneKey=${MANTA_PANE_KEY}" \\',
      '      --data-urlencode "tabId=${MANTA_TAB_ID}" \\',
      '      --data-urlencode "worktreeId=${MANTA_WORKTREE_ID}" \\',
      '      --data-urlencode "env=${MANTA_AGENT_HOOK_ENV}" \\',
      '      --data-urlencode "version=${MANTA_AGENT_HOOK_VERSION}" \\',
      '      --data-urlencode "payload=${hook_payload}" >/dev/null; then',
      `      ${emitMarkerCommand(hookPostedMarker)}`,
      '    fi',
      '  ) &',
      'fi'
    ].join('\n')
  )
  await waitForTerminalOutput(page, hookPostedMarker, 20_000)
}

test.describe('Localhost SSH', () => {
  test.skip(
    !RUN_LOCALHOST_SSH,
    'Set MANTA_E2E_SSH_LOCALHOST=1 to run this local-machine-only SSH E2E test.'
  )
  test.skip(
    !RUN_REMOTE_HOOKS,
    'Unset MANTA_FEATURE_REMOTE_AGENT_HOOKS or set it to 1 so remote PTYs keep pane identity and forward hook events.'
  )
  test.skip(process.platform === 'win32', 'Localhost SSH hook E2E uses POSIX hook scripts.')

  test('routes a terminal and agent-hook status over localhost SSH', async ({
    mantaPage,
    testRepoPath
  }) => {
    test.slow()
    await waitForSessionReady(mantaPage)
    await waitForActiveWorktree(mantaPage)

    const target = readLocalhostSshTarget()
    const remote = await mantaPage.evaluate(
      async ({ remotePath, target }) => {
        const store = window.__store
        if (!store) {
          throw new Error('Store unavailable')
        }

        const credentialUnsub = window.api.ssh.onCredentialRequest((request) => {
          void window.api.ssh.submitCredential({ requestId: request.requestId, value: null })
        })

        try {
          const { target: createdTarget, repoReadoptions } = await window.api.ssh.addTarget({
            target: {
              ...target,
              // Why: local-only E2E should not leave a long-lived relay process
              // behind if the Electron app is killed between cleanup hooks.
              relayGracePeriodSeconds: 1
            }
          })
          store.getState().recordSshRepoReadoptions(repoReadoptions)

          let state
          try {
            state = await window.api.ssh.connect({ targetId: createdTarget.id })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(
              `Failed to connect to localhost SSH target ${target.username}@${target.host || target.configHost}:${target.port}. ` +
                `Ensure sshd is running and key/agent auth is non-interactive. ${message}`
            )
          }

          if (!state || state.status !== 'connected') {
            throw new Error(`SSH target did not reach connected state: ${JSON.stringify(state)}`)
          }

          store.getState().setSshConnectionState(createdTarget.id, state)
          const labels = new Map(store.getState().sshTargetLabels)
          labels.set(createdTarget.id, createdTarget.label)
          store.getState().setSshTargetLabels(labels)

          const result = await window.api.repos.addRemote({
            connectionId: createdTarget.id,
            remotePath,
            displayName: 'Localhost SSH E2E'
          })
          if ('error' in result) {
            throw new Error(result.error)
          }

          await store.getState().fetchRepos()
          await store.getState().fetchWorktrees(result.repo.id)

          const worktrees = store.getState().worktreesByRepo[result.repo.id] ?? []
          const worktree =
            worktrees.find((candidate) => candidate.path === result.repo.path) ?? worktrees[0]
          if (!worktree) {
            throw new Error(`No remote worktree found for ${result.repo.path}`)
          }

          store.getState().setActiveWorktree(worktree.id)
          if ((store.getState().tabsByWorktree[worktree.id] ?? []).length === 0) {
            store.getState().createTab(worktree.id)
          }
          store.getState().setActiveTabType('terminal')

          return {
            targetId: createdTarget.id,
            repoId: result.repo.id,
            worktreeId: worktree.id
          }
        } finally {
          credentialUnsub()
        }
      },
      { remotePath: testRepoPath, target }
    )

    await expect(remote.targetId).toBeTruthy()
    await ensureTerminalVisible(mantaPage, 30_000)
    await waitForActiveTerminalManager(mantaPage, 45_000)
    const ptyId = await waitForActivePanePtyId(mantaPage, 45_000)
    const paneKey = await mantaPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const state = store.getState()
      const worktreeId = state.activeWorktreeId
      if (!worktreeId) {
        throw new Error('No active worktree')
      }
      const tabs = state.tabsByWorktree[worktreeId] ?? []
      const tabId =
        state.activeTabType === 'terminal'
          ? state.activeTabId
          : (state.activeTabIdByWorktree?.[worktreeId] ?? tabs[0]?.id)
      if (!tabId) {
        throw new Error('No active terminal tab')
      }
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
      if (!pane) {
        throw new Error('No active terminal pane')
      }
      return `${tabId}:${pane.leafId}`
    })
    const paneKeyLeafId = paneKey.slice(paneKey.indexOf(':') + 1)
    expect(paneKeyLeafId).toMatch(UUID_RE)
    await mantaPage.evaluate(() => {
      const state = window as unknown as {
        __sshAgentStatusEvents?: unknown[]
        __sshAgentStatusUnsubscribe?: () => void
      }
      state.__sshAgentStatusEvents = []
      state.__sshAgentStatusUnsubscribe?.()
      state.__sshAgentStatusUnsubscribe = window.api.agentStatus.onSet((event) => {
        state.__sshAgentStatusEvents?.push(event)
      })
    })

    const terminalMarker = marker('LOCALHOST_SSH')
    await execInTerminal(mantaPage, ptyId, emitMarkerCommand(terminalMarker))
    await waitForTerminalOutput(mantaPage, terminalMarker, 20_000)

    const envMarker = marker('AGENT_HOOK_ENV_OK')
    const envFailedMarker = marker('AGENT_HOOK_ENV_BAD')
    await execInTerminal(
      mantaPage,
      ptyId,
      [
        `if [ "$MANTA_PANE_KEY" = ${shellQuote(paneKey)} ] && [ -n "$MANTA_AGENT_HOOK_PORT" ] && [ -n "$MANTA_AGENT_HOOK_TOKEN" ] && /bin/sh -c 'test -n "$MANTA_PANE_KEY" && test -n "$MANTA_AGENT_HOOK_PORT" && test -n "$MANTA_AGENT_HOOK_TOKEN"'; then`,
        `  ${emitMarkerCommand(envMarker)}`,
        'else',
        '  token_state=${MANTA_AGENT_HOOK_TOKEN:+set}',
        `  printf '%s pane=%s port=%s token=%s endpoint=%s\\n' ${shellQuote(envFailedMarker)} "$MANTA_PANE_KEY" "$MANTA_AGENT_HOOK_PORT" "$token_state" "$MANTA_AGENT_HOOK_ENDPOINT"`,
        'fi'
      ].join('\n')
    )
    await waitForTerminalOutput(mantaPage, envMarker, 20_000)

    const pluginOverlayMarker = marker('AGENT_PLUGIN_OVERLAYS_OK')
    const pluginOverlayFailedMarker = marker('AGENT_PLUGIN_OVERLAYS_BAD')
    await execInTerminal(
      mantaPage,
      ptyId,
      [
        'opencode_status_file="$OPENCODE_CONFIG_DIR/plugins/manta-opencode-status.js"',
        'pi_status_file="$HOME/.pi/agent/extensions/manta-agent-status.ts"',
        'if [ -n "$OPENCODE_CONFIG_DIR" ] && [ -f "$opencode_status_file" ] && [ -f "$pi_status_file" ]; then',
        `  ${emitMarkerCommand(pluginOverlayMarker)}`,
        'else',
        `  printf '%s opencode=%s opencode_file=%s pi_file=%s\\n' ${shellQuote(pluginOverlayFailedMarker)} "$OPENCODE_CONFIG_DIR" "$opencode_status_file" "$pi_status_file"`,
        'fi'
      ].join('\n')
    )
    await waitForTerminalOutput(mantaPage, pluginOverlayMarker, 20_000)

    const prompt = `manta ssh e2e prompt ${Date.now()}`
    await postCodexHook(
      mantaPage,
      ptyId,
      { hook_event_name: 'UserPromptSubmit', prompt },
      'AGENT_HOOK_POSTED'
    )

    await expect
      .poll(
        async () =>
          mantaPage.evaluate(
            ({ paneKey, prompt, targetId, worktreeId }) => {
              const state = window.__store?.getState()
              const entries = Object.values(state?.agentStatusByPaneKey ?? {})
              return entries.some(
                (entry) =>
                  entry.paneKey === paneKey &&
                  entry.prompt === prompt &&
                  entry.agentType === 'codex' &&
                  entry.state === 'working' &&
                  state?.repos.some((repo) => repo.connectionId === targetId) === true &&
                  Object.values(state?.worktreesByRepo ?? {})
                    .flat()
                    .some((worktree) => worktree.id === worktreeId)
              )
            },
            { paneKey, prompt, targetId: remote.targetId, worktreeId: remote.worktreeId }
          ),
        {
          timeout: 20_000,
          message: 'Remote Codex hook status did not reach the renderer agent-status store'
        }
      )
      .toBe(true)

    const ctrlPrompt = `manta ssh ctrl-c interrupt ${Date.now()}`
    await postCodexHook(
      mantaPage,
      ptyId,
      { hook_event_name: 'UserPromptSubmit', prompt: ctrlPrompt },
      'AGENT_HOOK_CTRL_WORKING'
    )
    await focusTerminal(mantaPage)
    await mantaPage.keyboard.press('Control+C')
    await mantaPage.waitForTimeout(750)
    expect(
      await mantaPage.evaluate(
        ({ paneKey, prompt, targetId, worktreeId }) => {
          const state = window.__store?.getState()
          const entry = state?.agentStatusByPaneKey[paneKey]
          const events =
            (
              window as unknown as {
                __sshAgentStatusEvents?: {
                  prompt?: string
                  connectionId?: string | null
                  worktreeId?: string
                }[]
              }
            ).__sshAgentStatusEvents ?? []
          return {
            state: entry?.state,
            interrupted: entry?.interrupted,
            prompt: entry?.prompt,
            eventMatched: events.some(
              (event) =>
                event.prompt === prompt &&
                event.connectionId === targetId &&
                event.worktreeId === worktreeId
            )
          }
        },
        { paneKey, prompt: ctrlPrompt, targetId: remote.targetId, worktreeId: remote.worktreeId }
      )
    ).toEqual({
      state: 'working',
      interrupted: undefined,
      prompt: ctrlPrompt,
      eventMatched: true
    })

    await postCodexHook(
      mantaPage,
      ptyId,
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'exec_command',
        tool_input: { cmd: '/bin/sleep 90' }
      },
      'AGENT_HOOK_LATE_WORKING'
    )
    await expect
      .poll(
        () =>
          mantaPage.evaluate(
            ({ paneKey }) => {
              const entry = window.__store?.getState().agentStatusByPaneKey[paneKey]
              return {
                state: entry?.state,
                interrupted: entry?.interrupted,
                prompt: entry?.prompt
              }
            },
            { paneKey }
          ),
        { timeout: 5_000, message: 'Late remote working hook did not remain working' }
      )
      .toEqual({ state: 'working', interrupted: undefined, prompt: ctrlPrompt })

    const escapePrompt = `manta ssh escape interrupt ${Date.now()}`
    await postCodexHook(
      mantaPage,
      ptyId,
      { hook_event_name: 'UserPromptSubmit', prompt: escapePrompt },
      'AGENT_HOOK_ESCAPE_WORKING'
    )
    await focusTerminal(mantaPage)
    await mantaPage.keyboard.press('Escape')
    await mantaPage.waitForTimeout(750)
    expect(
      await mantaPage.evaluate(
        ({ paneKey }) => {
          const entry = window.__store?.getState().agentStatusByPaneKey[paneKey]
          return {
            state: entry?.state,
            interrupted: entry?.interrupted,
            prompt: entry?.prompt
          }
        },
        { paneKey }
      )
    ).toEqual({ state: 'working', interrupted: undefined, prompt: escapePrompt })
  })
})
