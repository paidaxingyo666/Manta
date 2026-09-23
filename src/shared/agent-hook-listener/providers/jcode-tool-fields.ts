import type { ToolSnapshot } from '../listener-event'
import {
  deriveFallbackToolInputPreview,
  deriveToolInputPreview,
  hasOwnField,
  readString,
  toolUpdate
} from '../tool-input-preview'

// Why: jcode has no per-tool approval prompt — its safety model denies or asks
// the model to reflect, both inside the tool. The one tool a *human* answers is
// ambient mode's `request_permission` (crates/jcode-app-core/src/tool/ambient.rs),
// resolved out of band with `jcode permissions`. Matching by exact name keeps a
// future rename visible instead of silently widening to unrelated tools; the
// aliases are the names jcode has shipped for the same surface.
const JCODE_USER_INPUT_TOOLS = new Set(['request_permission', 'ask_user', 'ask_question'])

export function isJcodeUserInputTool(toolName: string | undefined): boolean {
  return toolName !== undefined && JCODE_USER_INPUT_TOOLS.has(toolName)
}

/** jcode's `tool_input` field is the tool's argument JSON as a string. */
function parseJcodeToolInput(hookPayload: Record<string, unknown>): unknown {
  const raw = readString(hookPayload, 'tool_input')
  if (raw === undefined) {
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// Why: every jcode tool schema carries an `intent` string the model fills in with
// what it is doing, which reads better than a bare path when the tool-specific
// key (file_path, command, …) is missing.
function readJcodeIntent(toolInput: unknown): string | undefined {
  if (typeof toolInput !== 'object' || toolInput === null) {
    return undefined
  }
  const intent = (toolInput as Record<string, unknown>).intent
  return typeof intent === 'string' && intent.trim().length > 0 ? intent : undefined
}

export function extractJcodeToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (eventName === 'pre_tool') {
    const toolName = readString(hookPayload, 'tool_name')
    const toolInput = parseJcodeToolInput(hookPayload)
    const preview =
      deriveToolInputPreview(toolName, toolInput) ??
      readJcodeIntent(toolInput) ??
      deriveFallbackToolInputPreview(toolInput)
    return toolUpdate(
      {
        toolName,
        toolInput: preview,
        // Why: the question card renders the untruncated tool input; only the
        // ask-the-user tool gets one, and resolveToolState never inherits it, so
        // a resolved question cannot linger on the row.
        interactivePrompt:
          isJcodeUserInputTool(toolName) && toolInput !== undefined
            ? JSON.stringify(toolInput)
            : undefined
      },
      { hasToolInputField: hasOwnField(hookPayload, 'tool_input') }
    )
  }
  if (eventName === 'post_tool') {
    const toolName = readString(hookPayload, 'tool_name')
    // Why: post_tool reports no input. Keeping `hasToolInputField` false lets the
    // matching pre_tool preview survive the tool's completion instead of blanking.
    return toolUpdate({ toolName, toolInput: undefined }, { hasToolInputField: false })
  }
  if (eventName === 'turn_start') {
    // Why: a new turn starts with no tool; clearing both fields stops the previous
    // turn's last tool from being shown as this turn's live work.
    return toolUpdate({ toolName: undefined, toolInput: undefined }, { hasToolInputField: true })
  }
  if (eventName === 'turn_end') {
    const message =
      readString(hookPayload, 'last_assistant_text') ??
      readString(hookPayload, 'last_assistant_message')
    return {
      ...(message ? { lastAssistantMessage: message } : { clearLastAssistantMessage: true }),
      ...toolUpdate({ toolName: undefined, toolInput: undefined }, { hasToolInputField: true })
    }
  }
  return {}
}
