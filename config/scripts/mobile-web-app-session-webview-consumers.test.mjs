/**
 * What still reaches `react-native-webview` in the session closure, named one module at a time.
 *
 * On the web that package renders the line "React Native WebView does not support this platform"
 * where its consumer was, so a page does not go down over one — but nothing it was mounted for
 * works either, and the closure pays for a module that cannot do its job.
 *
 * C7.6 gives the two editors the plain states they already degrade to (`rulings-ota-c7.md` ruling
 * 8). The terminal is the third and is C7.5's, which drops the engine string and mounts xterm in
 * the document; it is listed here rather than left unsaid so the list is the work remaining.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mobileWebAppRouteClosure } from './build-mobile-web-app-bundle.mjs'
import { mobileWebAppDependenciesPresent } from './mobile-web-app-bundle-dependencies.mjs'

const mobileDir = fileURLToPath(new URL('../../mobile/', import.meta.url))
const describeClosure = mobileWebAppDependenciesPresent() ? describe : describe.skip

const SESSION = 'app/h/[hostId]/session/[worktreeId].tsx'

/** Still on the native component, and whose PR it is. */
const REMAINING = ['src/terminal/TerminalWebView.tsx']

/** The two this PR answered, whose `.web.tsx` the builder resolves instead. */
const ANSWERED = [
  'src/components/MobileRichMarkdownEditor.web.tsx',
  'src/components/MobileHtmlPreview.web.tsx'
]

const IMPORTS_WEBVIEW = /(?:from|import)\s*'[^']*react-native-webview'/

function webViewConsumers(closure) {
  return closure.local.filter((file) => {
    try {
      return IMPORTS_WEBVIEW.test(readFileSync(join(mobileDir, file), 'utf8'))
    } catch {
      return false
    }
  })
}

describeClosure(
  'the session closure and react-native-webview',
  () => {
    it('reaches it from the terminal and from nothing else', async () => {
      const closure = await mobileWebAppRouteClosure(SESSION)
      expect(webViewConsumers(closure)).toEqual(REMAINING)
    })

    it('resolves both editors to their web siblings, not to the native files', async () => {
      const closure = await mobileWebAppRouteClosure(SESSION)
      for (const file of ANSWERED) {
        expect(closure.local, file).toContain(file)
        expect(closure.local, file).not.toContain(file.replace('.web.tsx', '.tsx'))
      }
    })

    it('finds a consumer when there is one, so the list above is a measurement', async () => {
      // The control: the same walk over the module the list names, which does import it.
      expect(webViewConsumers({ local: REMAINING })).toEqual(REMAINING)
      expect(webViewConsumers({ local: ANSWERED })).toEqual([])
    })
  },
  240_000
)
