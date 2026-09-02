import { i18n } from './i18n'

/**
 * Defers a module-scope catalog of user-visible strings until first read.
 *
 * Building one at import time freezes English before the stored language
 * preference is applied, and `translate()` at module scope is rejected by the
 * guard for exactly that reason. Rebuilding on every read instead would hand
 * consumers a new array each render and defeat memo dependencies, so the value
 * is cached until the language actually changes.
 */
export function localizedConstant<T>(build: () => T): () => T {
  let cached: { language: string; value: T } | null = null
  return () => {
    if (cached === null || cached.language !== i18n.language) {
      cached = { language: i18n.language, value: build() }
    }
    return cached.value
  }
}
