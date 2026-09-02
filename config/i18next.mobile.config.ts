import { defineConfig } from 'i18next-cli'

const output =
  process.env.MANTA_I18N_EXTRACTION_OUTPUT ?? 'tmp/localization-extraction-mobile/{{language}}.json'

// Mirrors config/i18next.config.ts for the Expo tree. The two apps ship
// separate catalogs — the same English string often needs different copy on a
// phone — so extraction has to stay separate too.
export default defineConfig({
  locales: ['en'],
  extract: {
    input: ['mobile/**/*.{js,jsx,ts,tsx,mts,cts}'],
    ignore: [
      '**/node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
      '**/__tests__/**',
      '**/__snapshots__/**',
      '**/assets/**',
      // The translate() wrapper calls i18n.t() with a variable key; extraction
      // cannot resolve it and reports a phantom entry.
      'mobile/src/i18n/i18n.ts'
    ],
    output,
    defaultNS: false,
    functions: ['t', '*.t', 'translate', 'translateMain'],
    useTranslationNames: ['useTranslation'],
    sort: true,
    disablePlurals: true,
    removeUnusedKeys: true
  }
})
