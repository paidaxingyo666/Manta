/**
 * End-to-end coverage for the Automations runs surface.
 *
 * The test intentionally does not depend on seeded run history: a fresh E2E
 * profile may have no automations, but the Runs navigation and empty state must
 * still be usable.
 */

import { test, expect } from './helpers/manta-app'
import { waitForSessionReady } from './helpers/store'

test('opens the runs dashboard and returns to automations', async ({ mantaPage }) => {
  await waitForSessionReady(mantaPage)

  await mantaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openAutomationsPage()
  })

  const runsButton = mantaPage.getByRole('button', { name: 'Runs' })
  await expect(runsButton).toBeVisible()
  await runsButton.click()

  await expect(mantaPage.getByRole('navigation', { name: 'Automations breadcrumb' })).toBeVisible()
  await expect(mantaPage.getByText('Successful · 24h')).toBeVisible()
  await expect(mantaPage.getByText('Failed · 24h')).toBeVisible()
  await expect(mantaPage.getByText('Successful · 7d')).toBeVisible()
  await expect(mantaPage.getByText('Failed · 7d')).toBeVisible()
  await expect(mantaPage.getByRole('button', { name: 'Filters' })).toBeVisible()
  await expect(mantaPage.getByRole('button', { name: 'Refresh runs' })).toBeVisible()
  await expect(mantaPage.getByText('Automation', { exact: true })).toBeVisible()
  await expect(mantaPage.getByText('Triggered', { exact: true })).toBeVisible()
  await expect(mantaPage.getByText('Status', { exact: true })).toBeVisible()

  await mantaPage
    .getByRole('navigation', { name: 'Automations breadcrumb' })
    .getByRole('button', { name: 'Automations' })
    .click()
  await expect(mantaPage.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(runsButton).toBeVisible()
})
