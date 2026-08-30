import type { AgentHookSource } from '../../shared/agent-hook-relay'
import { MANTA_HOOK_RAW_JSON_TRANSPORT } from '../../shared/agent-hook-types'

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: { curlCommand?: string; indent?: string } = {}
): string[] {
  const curlCommand = options.curlCommand ?? 'curl'
  const indent = options.indent ?? '  '
  return [
    `if [ "\${MANTA_AGENT_HOOK_TRANSPORT:-}" = "${MANTA_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    `  manta_hook_metadata=$(printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$MANTA_PANE_KEY" "$MANTA_TAB_ID" "$MANTA_AGENT_LAUNCH_TOKEN" "$MANTA_WORKTREE_ID" "$MANTA_AGENT_HOOK_ENV" "$MANTA_AGENT_HOOK_VERSION" | base64 | tr -d '\\n') && \\`,
    `  [ -n "$manta_hook_metadata" ] && \\`,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${MANTA_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/json" \\`,
    `  ${indent}-H "X-Manta-Agent-Hook-Token: \${MANTA_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}-H "X-Manta-Agent-Hook-Meta-Encoding: base64" \\`,
    `  ${indent}-H "X-Manta-Agent-Hook-Meta: \${manta_hook_metadata}" \\`,
    `  ${indent}--data-binary @-`,
    'else',
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${MANTA_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/x-www-form-urlencoded" \\`,
    `  ${indent}-H "X-Manta-Agent-Hook-Token: \${MANTA_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}--data-urlencode "paneKey=\${MANTA_PANE_KEY}" \\`,
    `  ${indent}--data-urlencode "tabId=\${MANTA_TAB_ID}" \\`,
    `  ${indent}--data-urlencode "launchToken=\${MANTA_AGENT_LAUNCH_TOKEN}" \\`,
    `  ${indent}--data-urlencode "worktreeId=\${MANTA_WORKTREE_ID}" \\`,
    `  ${indent}--data-urlencode "env=\${MANTA_AGENT_HOOK_ENV}" \\`,
    `  ${indent}--data-urlencode "version=\${MANTA_AGENT_HOOK_VERSION}" \\`,
    `  ${indent}--data-urlencode "payload@-"`,
    'fi'
  ]
}
