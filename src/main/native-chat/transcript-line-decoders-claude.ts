// Claude JSONL line → NativeChatMessage decoder.

import {
  NATIVE_CHAT_INTERRUPTED_STATUS_TEXT,
  type NativeChatBlock,
  type NativeChatMessage
} from '../../shared/native-chat-types'
import {
  asRecord,
  extractString,
  parseJsonObject,
  timestampMs
} from '../ai-vault/session-scanner-values'
import { claudeContentBlocks } from './transcript-record-blocks'
import { claudeInterruptedMessageId } from './transcript-turn-markers'

export function decodeClaudeTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }
  const role = record.type
  if (role === 'attachment') {
    return decodeQueuedCommand(record, fallbackId)
  }
  if (role !== 'user' && role !== 'assistant') {
    return null
  }
  const timestamp = parseTimestamp(record.timestamp)
  const recordMessageId = extractString(record.uuid) ?? fallbackId
  if (claudeInterruptedMessageId(record)) {
    // Why: keep Claude's injected boilerplate out of the user-bubble path while
    // preserving the interruption as a quiet, replayable conversation status.
    return {
      id: recordMessageId,
      role: 'system',
      blocks: [{ type: 'text', text: NATIVE_CHAT_INTERRUPTED_STATUS_TEXT }],
      timestamp,
      source: 'transcript'
    }
  }
  const message = asRecord(record.message)
  const decodedBlocks = claudeContentBlocks(message?.content)
  if (decodedBlocks.length === 0) {
    return null
  }
  // Why: Claude structurally marks injected turns, but tool-result records are
  // genuine output and must remain visible even when the containing turn is meta.
  const isInjectedUserTurn =
    role === 'user' &&
    (record.isMeta === true || record.isSynthetic === true || record.isCompactSummary === true)
  const blocks = isInjectedUserTurn
    ? decodedBlocks.filter((block) => block.type === 'tool-result')
    : decodedBlocks
  if (blocks.length === 0) {
    return null
  }
  const messageId = extractString(record.uuid) ?? extractString(message?.id)
  return {
    id: messageId ?? fallbackId,
    role: claudeMessageRole(role, blocks),
    blocks,
    timestamp,
    source: 'transcript'
  }
}

/**
 * Typing while the agent is working never becomes a `user` turn.
 *
 * Claude queues it and records the text twice — once as a `queue-operation`
 * enqueue, once as this attachment — and neither is a role this decoder used to
 * accept, so the message was invisible in the transcript. On the desktop the TUI
 * echoes the keystrokes onto its input line and it looks interleaved; the phone
 * had only its own optimistic bubble, which retires by finding its text in the
 * transcript. It never could, so every interjection stayed pinned to the bottom
 * of the chat for the rest of the session.
 *
 * This side and not the `queue-operation` row: both carry the same text and
 * decoding both would show it twice. The attachment carries a `source_uuid` to
 * key on and the timestamp of the keystroke, which is where the desktop shows it.
 *
 * Only `origin.kind === 'human'`. Queued commands are also how injected and
 * automated prompts reach the agent, and those are not the user speaking.
 */
function decodeQueuedCommand(
  record: Record<string, unknown>,
  fallbackId: string
): NativeChatMessage | null {
  const attachment = asRecord(record.attachment)
  if (extractString(attachment?.type) !== 'queued_command') {
    return null
  }
  if (extractString(asRecord(attachment?.origin)?.kind) !== 'human') {
    return null
  }
  const text = extractString(attachment?.prompt)?.trim()
  if (!text) {
    return null
  }
  return {
    id: extractString(attachment?.source_uuid) ?? extractString(record.uuid) ?? fallbackId,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: parseTimestamp(attachment?.timestamp ?? record.timestamp),
    source: 'transcript'
  }
}

// Claude marks reasoning via `thinking` content blocks; when a message is made
// up solely of reasoning, surface it as a reasoning-role message.
function claudeMessageRole(
  role: 'user' | 'assistant',
  blocks: NativeChatBlock[]
): NativeChatMessage['role'] {
  if (role === 'user') {
    const onlyToolResults = blocks.every((block) => block.type === 'tool-result')
    return onlyToolResults && blocks.length > 0 ? 'tool' : 'user'
  }
  return role
}

function parseTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}
