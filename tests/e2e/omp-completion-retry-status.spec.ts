import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { getPiAgentStatusExtensionSource } from '../../src/main/pi/agent-status-extension-source'
import { test, expect } from './helpers/manta-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'

test('OMP completion retry clears the rendered working indicator', async ({
  mantaPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(mantaPage)
  await waitForActiveWorktree(mantaPage)
  await ensureTerminalVisible(mantaPage)
  await waitForActiveTerminalManager(mantaPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)
  const { paneKey, worktreeId } = await waitForActivePaneHookDescriptor(mantaPage)
  let completions = 0
  const proxy = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) {
      body += chunk
    }
    if (JSON.parse(body).payload.hook_event_name === 'agent_end' && ++completions === 1) {
      response.writeHead(503).end()
      return
    }
    const forwarded = await fetch(`http://127.0.0.1:${endpoint.port}/hook/omp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Manta-Agent-Hook-Token': endpoint.token },
      body
    })
    response.writeHead(forwarded.status).end()
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  try {
    const address = proxy.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP listener')
    }
    type Handler = (event: Record<string, unknown>, ctx: { isIdle: () => boolean }) => void
    const handlers = new Map<string, Handler>()
    const module: {
      exports: { default?: (api: { on: (name: string, fn: Handler) => void }) => void }
    } = { exports: {} }
    const { code } = await transform(getPiAgentStatusExtensionSource('omp'), {
      loader: 'ts',
      format: 'cjs'
    })
    runInNewContext(code, {
      module,
      exports: module.exports,
      require: createRequire(join(process.cwd(), 'package.json')),
      process: {
        pid: process.pid,
        argv: [],
        title: 'omp',
        env: {
          MANTA_PANE_KEY: paneKey,
          MANTA_TAB_ID: paneKey.split(':')[0],
          MANTA_WORKTREE_ID: worktreeId,
          MANTA_AGENT_HOOK_PORT: String(address.port),
          MANTA_AGENT_HOOK_TOKEN: endpoint.token,
          MANTA_AGENT_HOOK_ENV: endpoint.env,
          MANTA_AGENT_HOOK_VERSION: endpoint.version
        }
      },
      fetch,
      AbortController,
      Buffer,
      console,
      setTimeout,
      clearTimeout
    })
    expect(module.exports.default).toBeDefined()
    module.exports.default?.({ on: (name, fn) => handlers.set(name, fn) })
    const working = mantaPage.locator('[aria-label="Working"]')
    handlers.get('before_agent_start')?.(
      { prompt: 'OMP completion recovery' },
      { isIdle: () => false }
    )
    handlers.get('agent_start')?.({}, { isIdle: () => false })
    await expect(working.first()).toBeVisible()
    await mantaPage.screenshot({ path: testInfo.outputPath('before-working.png') })
    handlers.get('agent_end')?.({ willContinue: false }, { isIdle: () => false })
    await expect.poll(() => completions).toBe(2)
    await expect(working).toHaveCount(0)
    await expect
      .poll(() =>
        mantaPage.evaluate(
          (key) => window.__store?.getState().agentStatusByPaneKey[key]?.state,
          paneKey
        )
      )
      .toBe('done')
    await mantaPage.screenshot({ path: testInfo.outputPath('after-completed.png') })
  } finally {
    proxy.closeAllConnections()
    proxy.close()
  }
})
