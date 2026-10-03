import { fileURLToPath } from 'node:url'
import type { NativeChatBlock, NativeChatImageRefBlock } from '../../shared/native-chat-types'
import { AGENT_SESSION_HOST_STATUS_COPY } from '../../shared/agent-session-host-status-rows'
import { asRecord, extractString, parseJsonObject } from '../ai-vault/session-scanner-values'
// query module so each stays under the repo's file-size cap. Electron-free:
// runs on the OpenCode SQLite worker thread (#8864).

export type OpenCodePartRow = {
  message_id: string
  time_updated: number
  data: string | null
}

export const OPENCODE_TRANSCRIPT_MAX_ROW_BYTES = 2 * 1024 * 1024

export function opencodeMessageBlocks(partRows: OpenCodePartRow[]): NativeChatBlock[] {
  const blocks: NativeChatBlock[] = []
  for (const partRow of partRows) {
    if (partRow.data === null) {
      blocks.push({ type: 'text', text: AGENT_SESSION_HOST_STATUS_COPY['history-item-too-large'] })
      continue
    }
    const part = parseJsonObject(partRow.data)
    if (!part) {
      continue
    }
    switch (part.type) {
      case 'text': {
        if (part.synthetic === true) {
          break
        }
        const text = extractString(part.text)
        if (text) {
          blocks.push({ type: 'text', text })
        }
        break
      }
      case 'reasoning': {
        const text = extractString(part.text)
        if (text) {
          blocks.push({ type: 'text', text })
        }
        break
      }
      case 'tool': {
        blocks.push(...opencodeToolBlocks(part))
        break
      }
      case 'file': {
        const block = opencodeFileBlock(part)
        if (block) {
          blocks.push(block)
        }
        break
      }
      default:
        // step-start / snapshot / unknown bookkeeping parts render nothing.
        break
    }
  }
  return blocks
}

function opencodeFileBlock(part: Record<string, unknown>): NativeChatImageRefBlock | null {
  const mime = extractString(part.mime)
  if (!mime?.startsWith('image/')) {
    return null
  }
  const url = extractString(part.url)
  if (!url) {
    return null
  }
  const alt = extractString(part.filename)
  const withAlt = alt ? { alt } : {}
  if (url.startsWith('data:') || /^https?:\/\//.test(url)) {
    return { type: 'image-ref', url, ...withAlt }
  }
  if (url.startsWith('file://')) {
    try {
      return { type: 'image-ref', path: fileURLToPath(url), ...withAlt }
    } catch {
      // A malformed file URL still renders as an opaque ref.
      return { type: 'image-ref', url, ...withAlt }
    }
  }
  return { type: 'image-ref', path: url, ...withAlt }
}

function opencodeToolBlocks(part: Record<string, unknown>): NativeChatBlock[] {
  const name = extractString(part.tool) ?? 'tool'
  const state = asRecord(part.state)
  const callId = extractString(part.callID) ?? extractString(part.id)
  const status = state?.status
  const lifecycle = status === 'completed' ? 'completed' : status === 'error' ? 'failed' : 'running'
  const blocks: NativeChatBlock[] = [
    {
      type: 'tool-call',
      name,
      ...(callId ? { callId } : {}),
      state: lifecycle,
      input: state ? state.input : undefined
    }
  ]
  if (!state) {
    return blocks
  }
  const output = state.output
  const error = state.error
  if (typeof output !== 'string' && error == null) {
    // pending / running: the result has not been captured yet.
    return blocks
  }
  blocks.push({
    type: 'tool-result',
    ...(callId ? { callId } : {}),
    output:
      typeof output === 'string'
        ? output
        : typeof error === 'string'
          ? error
          : error != null
            ? JSON.stringify(error)
            : '',
    ...(error != null ? { isError: true } : {})
  })
  return blocks
}
