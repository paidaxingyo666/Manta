import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../agent-status-types'
import { clearPaneTurnCacheState, type HookListenerState } from '../listener-state'
import { resolvePrompt, resolveToolState } from '../prompt-fields'
import { extractToolFields, isNewTurnEvent } from '../provider-event-routing'
import { readString } from '../tool-input-preview'
import { isJcodeUserInputTool } from './jcode-tool-fields'

/** Text jcode reports for a failed turn or tool, preferred over a stale reply. */
function readJcodeErrorText(hookPayload: Record<string, unknown>): string | undefined {
  return hookPayload.status === 'error' ? readString(hookPayload, 'error') : undefined
}

export function normalizeJcodeEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (eventName === 'session_start') {
    // Why: jcode fires session_start on idle TUI open/attach/resume; mapping it
    // to 'working' would show a spinner before the user typed (mirrors Devin).
    clearPaneTurnCacheState(state, paneKey)
    return null
  }

  const toolName = readString(hookPayload, 'tool_name')
  // Why: only the pre_tool gate can report a pending question — post_tool fires
  // after the human already answered it.
  const isPendingUserInput = eventName === 'pre_tool' && isJcodeUserInputTool(toolName)
  const stateName = isPendingUserInput
    ? 'waiting'
    : eventName === 'turn_start' || eventName === 'pre_tool' || eventName === 'post_tool'
      ? 'working'
      : eventName === 'turn_end' || eventName === 'session_end'
        ? 'done'
        : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('jcode', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('jcode', eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('jcode', eventName)
    }),
    agentType: 'jcode',
    // Why: jcode stamps the live model on session_start/turn_start/turn_end, so
    // the row keeps naming the right model after an in-session `/model` switch.
    model: readString(hookPayload, 'model'),
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: readJcodeErrorText(hookPayload) ?? snapshot.lastAssistantMessage
  })
}
