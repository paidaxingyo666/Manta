import { test, expect } from './helpers/manta-app'
import { waitForSessionReady } from './helpers/store'

test.describe('network proxy bypass rules', () => {
  test('preserves newline-separated hosts and canonicalizes them on blur', async ({ mantaPage }) => {
    await waitForSessionReady(mantaPage)

    const original = await mantaPage.evaluate(() => window.api.settings.get())
    try {
      await mantaPage.evaluate(() => {
        const state = window.__store?.getState()
        state?.openSettingsTarget({ pane: 'advanced', repoId: null })
        state?.openSettingsPage()
      })

      await expect(mantaPage.getByRole('heading', { name: 'Advanced', exact: true })).toBeVisible()
      await mantaPage.getByRole('button', { name: 'Configure proxy' }).click()
      const bypassRules = mantaPage.locator('#settings-http-proxy-bypass-rules')
      await expect(bypassRules).toBeVisible()
      await expect(bypassRules).toHaveJSProperty('tagName', 'TEXTAREA')

      await bypassRules.fill('localhost\n127.0.0.1\n*.internal.corp')
      await expect(bypassRules).toHaveValue('localhost\n127.0.0.1\n*.internal.corp')
      await mantaPage.locator('#settings-http-proxy-url').focus()

      await expect
        .poll(
          async () =>
            (await mantaPage.evaluate(() => window.api.settings.get())).httpProxyBypassRules
        )
        .toBe('localhost;127.0.0.1;*.internal.corp')
      await expect(bypassRules).toHaveValue('localhost;127.0.0.1;*.internal.corp')
    } finally {
      await mantaPage.evaluate(
        (settings) =>
          window.api.settings.set({ httpProxyBypassRules: settings.httpProxyBypassRules ?? '' }),
        original
      )
    }
  })
})
