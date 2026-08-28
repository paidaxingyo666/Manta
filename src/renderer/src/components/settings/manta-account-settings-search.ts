import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getMantaAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.mantaAccount.account', 'Manta account'),
    description: translate(
      'auto.components.settings.mantaAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and Manta Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.mantaAccount.keywordCloud', 'cloud')
    ]
  }
])
