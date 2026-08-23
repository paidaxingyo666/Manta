/**
 * English strings that must survive translation unchanged.
 *
 * Brand names, CLI tokens, keycaps, and file extensions are identifiers, not
 * prose. "GitHub" translated into any language is still GitHub, and a
 * translator who renders it phonetically produces a label that no longer
 * matches the thing it points at. A keycap is stronger still: someone hunting
 * for Ctrl+U on their keyboard needs to read "Ctrl+U".
 *
 * The set is deliberately narrow — it only matches when the *whole* English
 * value is the literal. Prose that merely mentions a brand still needs
 * translating.
 */
export const TECHNICAL_LITERALS = new Set([
  // Brands and products
  'GitHub',
  'GitLab',
  'Linear',
  'Jira',
  'Tailscale',
  'Manta',
  'Codex',
  'Claude',
  'Claude Code',
  'GitHub Project ·',
  'GitHub Projects',
  'OpenAI API',
  'stablyai/manta',
  '@orca_build',
  // Protocol and format acronyms
  'SSH',
  'HTTPS',
  'URL',
  'API',
  'JSON',
  'Markdown',
  'Git',
  'PR',
  'MR',
  'ID',
  'UUID',
  'TLS',
  'WSL',
  'MANTA.YAML',
  'mermaid',
  'zsh',
  // Markdown toolbar levels
  'H1',
  'H2',
  'H3',
  // Literal formats, samples, and fixtures
  '[x]',
  // Keycaps and chords. Someone hunting for Ctrl+U on their keyboard needs to
  // read "Ctrl+U". `Esc` and `Tab` are absent on purpose: those two also occur
  // as spoken descriptions beside the keycap, and those do get translated.
  'Alt',
  'Cmd',
  'Ctrl',
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+D',
  'Ctrl+E',
  'Ctrl+L',
  'Ctrl+R',
  'Ctrl+U',
  'Ctrl+W',
  'Ctrl+Z',
  'Del',
  'Shift',
  'Shift+Tab',
  ':L{{value0}}',
  'YYYY-MM-DD',
  // Rate-limit window labels. They sit beside a progress bar in a two-column
  // row; "5小时" is wider than "5h" and wraps the row.
  '5h',
  '7d',
  'https://example.com',
  'npm run dev',
  'lin_api_...',
  'src/renderer packages/ui',
  '{{value0}}..HEAD',
  'SSH · {{value0}}',
  'Claude — auth refactor',
  'color-repro-switch-target',
  'mobile-stream-repro'
])
