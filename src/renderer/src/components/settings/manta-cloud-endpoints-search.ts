import type { SettingsSearchEntry } from './settings-search'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getMantaCloudEndpointsSearchEntries = createLocalizedCatalog(
  (): SettingsSearchEntry[] => [
    {
      title: translate(
        'auto.components.settings.MantaCloudEndpointsSection.title',
        'Self-hosted server'
      ),
      description: translate(
        'auto.components.settings.MantaCloudEndpointsSection.description',
        'Point sign-in and the mobile relay at your own server instead of the official one.'
      ),
      keywords: [
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.relay',
          'relay'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.selfHosted',
          'self-hosted'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.endpoint',
          'endpoint'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.director',
          'director'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.oauth',
          'oauth'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.server',
          'server'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.mantaCloudEndpoints.search.latency',
          'latency'
        )
      ]
    }
  ]
)
