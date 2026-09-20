import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { mobileWebAppBuildOptions } from './build-mobile-web-app-bundle.mjs'
import { mobileWebAppDependenciesPresent } from './mobile-web-app-bundle-dependencies.mjs'

const describeRouter = mobileWebAppDependenciesPresent() ? describe : describe.skip
const linking = { screens: { Preview: 'h/:hostId/files/preview/:worktreeId' } }
const params = {
  hostId: 'host',
  worktreeId: 'worktree',
  filePath: 'src/a + b.ts',
  search: '中文 & ?'
}
const encodedPath =
  '/h/host/files/preview/worktree?filePath=src%2Fa%20%2B%20b.ts&search=%E4%B8%AD%E6%96%87%20%26%20%3F'

describeRouter('Expo Router with the patched query-string API', () => {
  let router

  beforeAll(async () => {
    const requireMobile = createRequire(new URL('../../mobile/package.json', import.meta.url))
    const { entryPoints: _entryPoints, ...options } = mobileWebAppBuildOptions([])
    const built = await build({
      ...options,
      format: 'cjs',
      splitting: false,
      minify: false,
      stdin: {
        // Both Expo's CJS namespace import and React Navigation's default import must work.
        contents: `
          export { getPathFromState } from 'expo-router/build/fork/getPathFromState.js';
          export { getStateFromPath } from 'expo-router/build/fork/getStateFromPath.js';
          export { default as queryString } from 'query-string';
        `,
        resolveDir: dirname(requireMobile.resolve('expo-router/package.json')),
        sourcefile: 'router-query-contract.js',
        loader: 'js'
      }
    })
    const module = { exports: {} }
    runInNewContext(built.outputFiles[0].text, {
      module,
      exports: module.exports,
      console,
      process,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout
    })
    router = module.exports
  })

  it('stringifies route and query params through the real Expo implementation', () => {
    expect(router.getPathFromState({ routes: [{ name: 'Preview', params }] }, linking)).toBe(
      encodedPath
    )
  })

  it('parses escaped query params through the real Expo implementation', () => {
    expect(router.getStateFromPath(encodedPath, linking)).toMatchObject({
      routes: [{ name: 'Preview', params }]
    })
  })

  it('preserves the default API used by React Navigation', () => {
    const query = { filePath: params.filePath, search: params.search }
    expect(router.queryString.parse(router.queryString.stringify(query))).toEqual(query)
  })
})
