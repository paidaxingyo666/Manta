import { _electron as electron, expect } from '@stablyai/playwright-test'
import { build as buildMain } from 'esbuild'
import { build as buildRenderer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (process.env.MANTA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Requires MANTA_BACKGROUND_LAUNCH=1')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const parent = path.join(root, '.bench-fixtures')
mkdirSync(parent, { recursive: true })
const output = mkdtempSync(path.join(parent, 'omp-child-history-'))
const main = path.join(output, 'main.cjs')
await buildMain({
  entryPoints: [path.join(root, 'tests/tools/benchmarks/spinner-rendering/main.ts')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
await buildRenderer({
  configFile: false,
  root: import.meta.dirname,
  base: './',
  logLevel: 'silent',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: true }
})
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
const app = await electron.launch({ args: [main], env: { ...env, MANTA_BACKGROUND_LAUNCH: '1' } })
const report = {
  scope:
    'Production subagent rows with injected history records; callback evidence, not full launch UI.'
}
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error)
  })
  await page.goto(pathToFileURL(path.join(output, 'renderer/index.html')).href)
  await expect(page.getByText('OMP worker with saved conversation')).toBeVisible()
  await expect(page.getByRole('button', { name: /Resume/ })).toHaveCount(1)
  const cdp = await page.context().newCDPSession(page)
  const capture = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(output, `${name}.png`), Buffer.from(data, 'base64'))
  }
  await capture('child-resume-affordance')
  await page.getByRole('button', { name: 'Resume in Worktree' }).click()
  await expect(page.getByText('Resume child in folder:project')).toBeVisible()
  await capture('child-resume-callback')
  expect(errors).toEqual([])
  report.windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(report.windows.every((window) => !window.visible && !window.focused)).toBe(true)
} finally {
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`OMP child history evidence: ${output}`)
  await app.close()
}
