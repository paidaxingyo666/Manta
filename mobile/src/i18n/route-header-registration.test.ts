/**
 * Every screen draws its own header, so a route missing from the Stack gets the
 * navigator's default one instead — a second back button above the app's own.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8')
// A route that only returns <Redirect> never paints, so it has no header to
// suppress and no reason to appear in the Stack.
const routes = readdirSync(new URL('../../app', import.meta.url))
  // `_layout.web.tsx` is the page's root layout, a platform sibling of `_layout.tsx`, not a screen.
  .filter((name) => name.endsWith('.tsx') && !name.startsWith('_layout.'))
  .filter(
    (name) =>
      !readFileSync(new URL(`../../app/${name}`, import.meta.url), 'utf8').includes('<Redirect')
  )
  .map((name) => name.replace(/\.tsx$/, ''))
  .filter((name) => name !== 'index')

describe('route header registration', () => {
  it('registers every top-level screen with headerShown: false', () => {
    const missing = routes.filter((route) => !layout.includes(`name="${route}"`))
    expect(missing, 'add a Stack.Screen entry in app/_layout.tsx').toEqual([])
  })
})
