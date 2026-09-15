/**
 * Every file that still reaches mobile's raw RPC request port, held as data.
 *
 * A reference is any direct reach for the port: a `.sendRequest` access or declaration, a
 * `'sendRequest'` selector such as `Pick<RpcClient, 'sendRequest'>`, a call to the coalescing
 * second sender `sendSingleFlightRequest`, or an import of unvalidated-rpc-request-port.ts.
 * The count is per file and is a ceiling, not a target: unvalidated-rpc-request-port-boundary.test.ts
 * fails on a file that is not listed, on a listed file that no longer reaches the port, and on a
 * listed file whose count went up. Both lists only shrink.
 *
 * The owners are permanent — they implement, route or validate the port. The pending list is the
 * step-4 migration backlog and shares one reason, stated once here instead of 144 times:
 * the call site predates the typed contract and still picks its own method string, its own
 * acceptance rule and its own decoding. Replacing one with an RpcOperation deletes its line.
 *
 * Where a group below names a blocker, it is a recording blocker, not a migration blocker.
 * Pointing a site at an operation is mechanical; the golden recorded against the old code before
 * the refactor is the only parity proof this migration has. So a site the recorder cannot mount
 * cannot be recorded, and unrecorded sites do not migrate.
 */
export type UnvalidatedRpcRequestPortEntry = {
  readonly file: string
  readonly references: number
}

/** Modules whose job is the port. These do not shrink to zero. */
export const UNVALIDATED_RPC_REQUEST_PORT_OWNERS: readonly UnvalidatedRpcRequestPortEntry[] = [
  // Implements the port over the device-to-host websocket.
  { file: 'src/transport/direct-rpc-client.ts', references: 3 },
  // Fakes the port for the supervisor suites; a non-test file only because tsconfig excludes tests.
  { file: 'src/transport/mobile-endpoint-supervisor-test-fakes.ts', references: 2 },
  // Implements the port over a relay channel.
  { file: 'src/transport/mobile-relay-physical-client.ts', references: 2 },
  // Supplies the port for one relay session.
  { file: 'src/transport/mobile-relay-rpc-session.ts', references: 1 },
  // A second raw sender: string method in, unread envelope out. Its callers are fenced too.
  { file: 'src/transport/request-single-flight.ts', references: 3 },
  // Owns connect-wait, timeout and replay bookkeeping for every raw request.
  { file: 'src/transport/rpc-client-request-tracker.ts', references: 1 },
  // Composes the port into RpcClient, which is why every holder of a client still carries it.
  { file: 'src/transport/rpc-client.ts', references: 2 },
  // The typed boundary itself — the one module that turns a reply into a declared type.
  { file: 'src/transport/rpc-operation.ts', references: 5 },
  // Forwards the port across a physical-client cutover.
  { file: 'src/transport/stable-logical-rpc-client.ts', references: 2 },
  // Names the port as the recording oracle's sender contract; a non-test file for the same reason.
  { file: 'src/test-support/rpc-recording/recording-scenario.ts', references: 1 },
  // Scripts the port for the recording oracle, over the real tracker and logical client.
  { file: 'src/test-support/rpc-recording/scripted-rpc-transport.ts', references: 5 }
]

/** Call sites awaiting migration to a typed operation. Grouped by the feature area that owns them. */
export const UNVALIDATED_RPC_REQUEST_PORT_PENDING: readonly UnvalidatedRpcRequestPortEntry[] = [
  // app/h/[hostId]/ — Expo route screens
  { file: 'app/h/[hostId]/accounts.tsx', references: 2 },

  // app/ — Expo route screens
  { file: 'app/terminal-settings.tsx', references: 3 },

  // src/agent-history/ — agent history loads
  { file: 'src/agent-history/MobileAgentSessionHistoryPanel.tsx', references: 6 },
  { file: 'src/agent-history/use-mobile-agent-history-state.ts', references: 2 },

  // src/browser/ — hosted browser control
  { file: 'src/browser/use-mobile-browser-commands.ts', references: 5 },
  { file: 'src/browser/use-mobile-browser-request.ts', references: 1 },

  // src/components/ — shared widgets that fetch their own data. The New Workspace drawer's
  // execution target, setup hook, runtime context and Codex capability probe migrated in step 4:
  // see new-workspace-operations.ts, codex-reset-credit-capability-operations.ts, and the SSH and
  // agent-detection operations in tasks/mobile-workspace-source-operations.ts. Two remain, neither
  // recordable. codex-reset-credit.ts loads under the module loader; its attempt-journal access
  // throws on async-storage at call time, before the send, and nothing guards it away. The repo
  // list fails one module further out: it renders use-last-visited-worktree-repo.ts, whose default
  // import of async-storage is a property read the loader's proxy refuses.
  { file: 'src/components/codex-reset-credit.ts', references: 3 },
  { file: 'src/components/use-new-workspace-repositories.ts', references: 1 },

  // src/dictation/ — dictation session control
  { file: 'src/dictation/mobile-dictation-setup.ts', references: 10 },

  // src/files/ — file read, write and preview. The preview loader, the terminal-artifact grant
  // refresh and save, the session file tab and the mutation-ownership capture migrated in step 4:
  // see mobile-file-preview-operations.ts, mobile-file-tab-doc-operations.ts and
  // mobile-file-ownership-operations.ts. The explorer panel's two sends sit inline in a React
  // Native screen, which the recorder cannot mount and so cannot record.
  { file: 'src/files/MobileFileExplorerPanel.tsx', references: 2 },

  // src/home/ — home screen host reads. The stats card and both task-provider probes migrated in
  // step 4 (mobile-home-host-operations.ts, plus the shared task-tooling reads in
  // tasks/mobile-task-runtime-operations.ts). The accounts read stays: its decoder is re-exported
  // through a React Native screen module, which no recording can load.
  { file: 'src/home/mobile-home-host-requests.ts', references: 2 },

  // src/hooks/ — cross-screen data hooks
  { file: 'src/hooks/mobile-dictation-audio-chunk.ts', references: 1 },
  { file: 'src/hooks/mobile-dictation-desktop-start.ts', references: 4 },
  { file: 'src/hooks/use-mobile-dictation.ts', references: 4 },

  // src/host-screen/ — host screen catalog and actions. The repo and label metadata reads, the
  // desktop view-settings mirror and the list's pin, remove and activate mutations migrated in
  // step 4; see host-screen-operations.ts. What is left sends from inside a React Native screen,
  // which the recorder cannot mount.
  { file: 'src/host-screen/host-screen-overlays.tsx', references: 1 },

  // src/notifications/ — push registration and delivery
  { file: 'src/notifications/mobile-notifications.ts', references: 1 },
  { file: 'src/notifications/push-dismissal-reconciliation.ts', references: 2 },
  { file: 'src/notifications/push-registration.ts', references: 3 },

  // src/session/ — session screen: chat, diff review, PR actions, tabs
  { file: 'src/session/ai-vault-resume-launch.ts', references: 3 },
  { file: 'src/session/ai-vault-resume-preparation.ts', references: 2 },
  { file: 'src/session/github-pr-mutations.ts', references: 16 },
  { file: 'src/session/github-pr-rpc.ts', references: 9 },
  { file: 'src/session/mobile-clipboard-image.ts', references: 7 },
  { file: 'src/session/mobile-diff-review-loaders.ts', references: 5 },
  { file: 'src/session/mobile-file-tap-open.ts', references: 3 },
  { file: 'src/session/mobile-image-attachment.ts', references: 2 },
  { file: 'src/session/mobile-native-chat-image-attachment.ts', references: 1 },
  { file: 'src/session/mobile-native-chat-image-send.ts', references: 2 },
  { file: 'src/session/mobile-native-chat-send.ts', references: 2 },
  { file: 'src/session/mobile-native-chat-session-option-persistence.ts', references: 1 },
  { file: 'src/session/mobile-native-chat-stale-input.ts', references: 1 },
  { file: 'src/session/mobile-new-tab-agent-loader.ts', references: 4 },
  { file: 'src/session/mobile-session-tab-activation.ts', references: 3 },
  { file: 'src/session/mobile-session-tabs-stream-health.ts', references: 1 },
  { file: 'src/session/mobile-structured-agent-session-launch.ts', references: 3 },
  { file: 'src/session/mobile-structured-agent-session-rpc.ts', references: 1 },
  { file: 'src/session/pr-ai-triage-launch.ts', references: 3 },
  { file: 'src/session/use-live-worktree-name.ts', references: 1 },
  { file: 'src/session/use-mobile-diff-review-comment-actions.ts', references: 1 },
  { file: 'src/session/use-mobile-diff-review-git-actions.ts', references: 2 },
  { file: 'src/session/use-mobile-diff-review-interactions.ts', references: 1 },
  { file: 'src/session/use-mobile-diff-review-send-actions.ts', references: 3 },
  { file: 'src/session/use-mobile-file-tap-handlers.ts', references: 1 },
  { file: 'src/session/use-mobile-native-chat-file-search.ts', references: 2 },
  { file: 'src/session/use-mobile-native-chat-readability.ts', references: 1 },
  { file: 'src/session/use-mobile-native-chat-session.ts', references: 1 },
  { file: 'src/session/use-mobile-native-chat-stop.ts', references: 1 },
  { file: 'src/session/use-mobile-pr-actions.ts', references: 1 },
  { file: 'src/session/use-mobile-pr-branch-context.ts', references: 2 },
  { file: 'src/session/use-mobile-pr-comment-actions.ts', references: 1 },
  { file: 'src/session/use-mobile-pr-title-action.ts', references: 1 },
  { file: 'src/session/use-mobile-session-accessory-selection.ts', references: 1 },
  { file: 'src/session/use-mobile-session-close-actions.ts', references: 3 },
  { file: 'src/session/use-mobile-session-content-create-actions.ts', references: 4 },
  { file: 'src/session/use-mobile-session-diff-comments.ts', references: 2 },
  { file: 'src/session/use-mobile-session-document-readers.ts', references: 2 },
  { file: 'src/session/use-mobile-session-markdown-actions.ts', references: 1 },
  { file: 'src/session/use-mobile-session-startup.ts', references: 2 },
  { file: 'src/session/use-mobile-session-terminal-create-actions.ts', references: 2 },
  { file: 'src/session/use-mobile-session-terminal-input.ts', references: 2 },
  { file: 'src/session/use-mobile-session-terminal-list.ts', references: 1 },
  { file: 'src/session/use-mobile-session-terminal-send-actions.ts', references: 2 },
  { file: 'src/session/use-mobile-session-terminal-stream-display.ts', references: 1 },
  { file: 'src/session/use-mobile-terminal-paste.ts', references: 1 },
  { file: 'src/session/use-quick-commands.ts', references: 2 },

  // src/settings/ — settings screen actions. Its one reference is the client parameter it forwards
  // to dictation/mobile-dictation-setup.ts, so it can only drop when that file migrates.
  { file: 'src/settings/native-voice-settings-operations.ts', references: 1 },

  // src/settings/ — notification display probe
  { file: 'src/settings/notification-display-test.tsx', references: 1 },

  // src/source-control/ — one dynamic dispatcher left; the other 13 files migrated in step 4.
  // Its single reference multiplexes git.commit, git.status, git.upstreamStatus, git.fetch,
  // git.pull, git.push and every `{ method, params }` action step five other hooks hand it, so
  // it cannot drop below one until that step model is typed. See mobile-git-read-operations.ts
  // and mobile-git-mutation-operations.ts for the operations the rest of the domain now sends.
  { file: 'src/source-control/use-mobile-git-requests.ts', references: 1 },

  // src/tasks/ — task lists, filters and mutations. The workspace-creation half migrated in
  // step 4: create, hosted-base resolution, SSH/agent preflight, sparse presets, the Smart
  // source picker's provider reads and the screen's own preference writes. See
  // mobile-workspace-create-operations.ts, mobile-workspace-source-operations.ts,
  // mobile-task-runtime-operations.ts and mobile-task-source-search-operations.ts. What is left
  // is the provider item/detail/mutation half, plus two files that cannot reach zero:
  // mobile-tasks-source-family.test-support.ts matches the literal in a source scanner rather
  // than sending anything, and use-mobile-tasks-project-file-merge-actions.tsx and
  // use-mobile-tasks-hosted-metadata-actions.tsx each multiplex a `{ method, params }` step the
  // pickers hand them at runtime.
  { file: 'src/tasks/mobile-tasks-filter-pickers.tsx', references: 1 },
  { file: 'src/tasks/mobile-tasks-source-family.test-support.ts', references: 1 },
  { file: 'src/tasks/use-mobile-tasks-github-check-file-actions.tsx', references: 5 },
  { file: 'src/tasks/use-mobile-tasks-github-reply-merge-actions.tsx', references: 5 },
  { file: 'src/tasks/use-mobile-tasks-gitlab-github-status-actions.tsx', references: 3 },
  { file: 'src/tasks/use-mobile-tasks-hosted-comment-review-actions.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-hosted-metadata-actions.tsx', references: 2 },
  { file: 'src/tasks/use-mobile-tasks-item-detail-loading.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-item-detail-metadata-effects.tsx', references: 2 },
  { file: 'src/tasks/use-mobile-tasks-linear-item-actions.tsx', references: 3 },
  { file: 'src/tasks/use-mobile-tasks-list-and-detail-effects.tsx', references: 2 },
  { file: 'src/tasks/use-mobile-tasks-project-detail-loading.tsx', references: 1 },
  { file: 'src/tasks/use-mobile-tasks-project-file-merge-actions.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-project-loading-actions.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-project-metadata-actions.tsx', references: 3 },
  { file: 'src/tasks/use-mobile-tasks-project-metadata-loading.tsx', references: 3 },
  { file: 'src/tasks/use-mobile-tasks-project-repository-resolution.tsx', references: 1 },
  { file: 'src/tasks/use-mobile-tasks-project-review-check-actions.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-project-thread-reply-actions.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-project-workspace-comment-actions.tsx', references: 3 },
  { file: 'src/tasks/use-mobile-tasks-provider-load-actions.tsx', references: 5 },
  { file: 'src/tasks/use-mobile-tasks-route-and-item-state.tsx', references: 1 },
  { file: 'src/tasks/use-mobile-tasks-task-create-actions.tsx', references: 3 },
  { file: 'src/tasks/use-mobile-tasks-task-list-loading.tsx', references: 4 },
  { file: 'src/tasks/use-mobile-tasks-task-pagination-actions.tsx', references: 1 },

  // src/terminal/ — terminal input, viewport and queries
  { file: 'src/terminal/mobile-terminal-query-reply.ts', references: 2 },
  { file: 'src/terminal/terminal-live-accessory-raw-send.ts', references: 2 },
  { file: 'src/terminal/terminal-viewport-refit.ts', references: 1 },
  { file: 'src/terminal/worker-terminal-takeover-report.ts', references: 2 },

  // src/transport/ — pairing, endpoint probing and capability reads
  { file: 'src/transport/host-status-gates.ts', references: 1 },
  { file: 'src/transport/mobile-relay-credential-rotation.ts', references: 2 },
  { file: 'src/transport/mobile-relay-direct-upgrade.ts', references: 2 },
  { file: 'src/transport/mobile-relay-pairing-recovery.ts', references: 2 },
  { file: 'src/transport/mobile-runtime-capability-negotiation.ts', references: 2 },
  { file: 'src/transport/pairing-candidate-race.ts', references: 1 },
  { file: 'src/transport/pairing-relay-candidate.ts', references: 4 },
  { file: 'src/transport/pre-profile-pairing-coordinator.ts', references: 2 },
  { file: 'src/transport/runtime-capability-probe.ts', references: 2 }
]
