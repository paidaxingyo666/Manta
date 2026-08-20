import { translate } from '../src/i18n/i18n'
export const FAKE_SCROLLBACK = [
  '$ claude "refactor the auth module to use JWT tokens"',
  '',
  '⏳ Working on it...',
  '',
  "I'll refactor the auth module. Here's my plan:",
  '1. Replace session-based auth with JWT',
  '2. Add token refresh endpoint',
  '3. Update middleware',
  '',
  'Let me start by reading the current auth module...',
  ''
].join('\n')

export const STREAMING_CHUNKS = [
  'Reading src/auth/middleware.ts...\n',
  'Reading src/auth/session.ts...\n',
  '\nI see the current implementation uses express-session.\n',
  "I'll replace it with jsonwebtoken.\n",
  '\nUpdating src/auth/middleware.ts...\n'
]

export function createMockTerminals(worktreeId?: string) {
  const resolvedWorktreeId = worktreeId ?? 'repo-1::/tmp/manta-mobile-repro/manta'
  return [
    {
      handle: 'term-1',
      worktreeId: resolvedWorktreeId,
      title: translate(
        'auto.mobile.scripts.mock.server.terminal.fixtures.8f249d8343',
        'Claude — auth refactor'
      ),
      isActive: true,
      hasRunningProcess: true
    },
    {
      handle: 'term-2',
      worktreeId: resolvedWorktreeId,
      title: translate('auto.mobile.scripts.mock.server.terminal.fixtures.fc2f70424d', 'zsh'),
      isActive: false,
      hasRunningProcess: false
    }
  ]
}
