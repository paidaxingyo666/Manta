import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { MantaCloudEndpointOverrides } from '../../../../shared/manta-cloud-endpoints'

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))

const {
  MantaCloudEndpointsSection,
  hasConfiguredMantaCloudEndpoints,
  validateMantaCloudEndpointsDraft
} = await import('./MantaCloudEndpointsSection')

function render(endpoints?: MantaCloudEndpointOverrides): string {
  return renderToStaticMarkup(
    <MantaCloudEndpointsSection
      settings={{ mantaCloudEndpoints: endpoints } as unknown as GlobalSettings}
    />
  )
}

/**
 * Every input the endpoint form owns, by DOM id.
 *
 * Asserted as a set rather than one-by-one because the failure this guards
 * against is a *missing* field: a value saved into settings that the user was
 * never given a way to type. That looks like nothing at all in the UI, and
 * searching the built bundle for the label text does not catch it — the string
 * can be present in a translation catalog while the input is never rendered.
 */
const FIELD_IDS = [
  'settings-manta-cloud-api',
  'settings-manta-cloud-relay',
  'settings-manta-cloud-client-id',
  'settings-manta-cloud-enrollment'
]

describe('MantaCloudEndpointsSection', () => {
  it('renders every endpoint field once the section is open', () => {
    const markup = render({ apiBaseUrl: 'https://relay.example.com' })
    for (const id of FIELD_IDS) {
      expect(markup, `missing input: ${id}`).toContain(`id="${id}"`)
    }
  })

  it('never renders a stored enrolment secret back into the DOM', () => {
    // A prefilled credential sits in the markup as an input value on every
    // settings render, which is one screenshot or DOM dump away from leaking.
    // The field starts empty and the placeholder says a secret is already set.
    const markup = render({
      apiBaseUrl: 'https://relay.example.com',
      relayDirectorUrl: 'https://relay.example.com',
      enrollmentSecret: 'super-secret-value'
    })
    expect(markup).toContain('id="settings-manta-cloud-enrollment"')
    expect(markup).toContain('type="password"')
    expect(markup).not.toContain('super-secret-value')
    expect(markup).toContain('Saved')
  })

  it('treats an untouched secret field as unchanged, not as a deletion', () => {
    // Otherwise editing any other field would silently drop the secret and the
    // desktop would fall back to opening a browser at the next sign-in.
    const draft = {
      apiBaseUrl: 'https://relay.example.com',
      relayDirectorUrl: 'https://relay.example.com',
      clientId: 'manta-desktop',
      enrollmentSecret: ''
    }
    const kept = validateMantaCloudEndpointsDraft(draft, 'already-stored')
    expect(kept.ok && kept.value?.enrollmentSecret).toBe('already-stored')

    const replaced = validateMantaCloudEndpointsDraft(
      { ...draft, enrollmentSecret: 'brand-new' },
      'already-stored'
    )
    expect(replaced.ok && replaced.value?.enrollmentSecret).toBe('brand-new')

    // Clearing every field is still a real "use the official endpoints" action.
    const cleared = validateMantaCloudEndpointsDraft(
      { apiBaseUrl: '', relayDirectorUrl: '', clientId: '', enrollmentSecret: '' },
      'already-stored'
    )
    expect(cleared.ok && cleared.value).toBeUndefined()
  })

  it('reveals the section when any endpoint is already configured', () => {
    // Otherwise a configured deployment hides its own settings behind a
    // collapsed section, and the values look unset.
    expect(hasConfiguredMantaCloudEndpoints({} as GlobalSettings)).toBe(false)
    expect(
      hasConfiguredMantaCloudEndpoints({
        mantaCloudEndpoints: { enrollmentSecret: 's' }
      } as unknown as GlobalSettings)
    ).toBe(true)
    expect(render()).not.toContain('id="settings-manta-cloud-api"')
  })
})
