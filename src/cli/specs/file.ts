import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['file', 'open'],
    summary:
      'Open a file as a tab in its worktree without changing your view; --focus brings you to it',
    usage: 'manta file open <path> [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'worktree', 'focus'],
    positionalArgs: ['path'],
    notes: [
      'The file opens as a tab in that worktree without changing what you are looking at, even in the worktree on screen. --focus brings you to it; agents should pass --focus only when the user asked to see the file.',
      'The path may be relative to the selected worktree or an absolute path inside that worktree. When --worktree is omitted, local CLI calls infer the current Manta worktree from cwd.'
    ],
    examples: [
      'manta file open src/App.tsx',
      'manta file open --path docs/readme.md --worktree active --focus'
    ]
  },
  {
    path: ['file', 'diff'],
    summary:
      'Open a file diff as a tab in its worktree without changing your view; --focus brings you to it',
    usage: 'manta file diff <path> [--staged] [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'staged', 'worktree', 'focus'],
    positionalArgs: ['path'],
    notes: [
      'The file opens as a tab in that worktree without changing what you are looking at, even in the worktree on screen. --focus brings you to it; agents should pass --focus only when the user asked to see the file.',
      'Diffs default to unstaged changes. Pass --staged to open the staged source-control diff.',
      'The path may be relative to the selected worktree or an absolute path inside that worktree.'
    ],
    examples: [
      'manta file diff src/App.tsx',
      'manta file diff --path package.json --staged --worktree branch:feature'
    ]
  },
  {
    path: ['file', 'open-changed'],
    summary:
      'Open all git-changed files as tabs without changing your view; --focus brings you to them',
    usage:
      'manta file open-changed [--mode edit|diff|both] [--worktree <selector>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mode', 'worktree', 'focus'],
    notes: [
      'The files open as tabs in that worktree without changing what you are looking at, even in the worktree on screen. --focus brings you to them; agents should pass --focus only when the user asked to see the files.',
      'For v1, changed files come from git status for the selected worktree.',
      'The default mode is diff. Edit mode skips deleted files because there is no file to open.'
    ],
    examples: [
      'manta file open-changed',
      'manta file open-changed --mode both',
      'manta file open-changed --mode diff --worktree active'
    ]
  }
]
