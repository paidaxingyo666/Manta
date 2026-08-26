/**
 * Typing while the agent works must still reach the transcript.
 *
 * Claude never records an interjection as a `user` turn. It writes the text
 * twice — a `queue-operation` enqueue and a `queued_command` attachment — and
 * this decoder accepted neither, so the message was invisible to every reader of
 * the transcript. The desktop looked right anyway because the TUI echoes
 * keystrokes onto its input line; the phone had only its own optimistic bubble,
 * which retires by finding its text in the transcript, so every interjection
 * stayed pinned to the bottom of the chat for the rest of the session.
 *
 * Shapes here are taken from a real Claude session file.
 */
import { describe, expect, it } from 'vitest'
import { decodeClaudeTranscriptLine } from './transcript-line-decoders'

const SENT_AT = '2026-08-26T09:55:41.942Z'

function queuedCommandLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'attachment',
    timestamp: SENT_AT,
    attachment: {
      type: 'queued_command',
      prompt: 'take a look now that the phone is plugged in',
      source_uuid: '5395784c-bd3f-4df6-8b10-49a8f0d837c0',
      commandMode: 'prompt',
      origin: { kind: 'human' },
      timestamp: SENT_AT,
      ...overrides
    }
  })
}

describe('decodeClaudeTranscriptLine, queued human input', () => {
  it('decodes an interjection as the user turn it never got recorded as', () => {
    expect(decodeClaudeTranscriptLine(queuedCommandLine(), 'fb-1')).toEqual({
      id: '5395784c-bd3f-4df6-8b10-49a8f0d837c0',
      role: 'user',
      blocks: [{ type: 'text', text: 'take a look now that the phone is plugged in' }],
      timestamp: Date.parse(SENT_AT),
      source: 'transcript'
    })
  })

  // The keystroke time, not the time the agent got round to it — that is where
  // the desktop shows it, and the two surfaces should not disagree.
  it('times it from the attachment, not the row', () => {
    const line = JSON.stringify({
      type: 'attachment',
      timestamp: '2026-08-26T09:55:50.564Z',
      attachment: {
        type: 'queued_command',
        prompt: 'later',
        origin: { kind: 'human' },
        timestamp: SENT_AT
      }
    })

    expect(decodeClaudeTranscriptLine(line, 'fb-2')?.timestamp).toBe(Date.parse(SENT_AT))
  })

  // Queued commands are also how injected and automated prompts reach the agent.
  it('ignores a queued command that is not the user speaking', () => {
    expect(decodeClaudeTranscriptLine(queuedCommandLine({ origin: { kind: 'system' } }), 'fb-3')).toBeNull()
    expect(decodeClaudeTranscriptLine(queuedCommandLine({ origin: {} }), 'fb-4')).toBeNull()
  })

  it('ignores attachments that are not queued commands', () => {
    expect(decodeClaudeTranscriptLine(queuedCommandLine({ type: 'file' }), 'fb-5')).toBeNull()
  })

  it('ignores a queued command with nothing in it', () => {
    expect(decodeClaudeTranscriptLine(queuedCommandLine({ prompt: '   ' }), 'fb-6')).toBeNull()
  })

  /**
   * The enqueue row carries the same text. Decoding both would show every
   * interjection twice.
   */
  it('leaves the enqueue row alone', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: SENT_AT,
      content: 'take a look now that the phone is plugged in'
    })

    expect(decodeClaudeTranscriptLine(line, 'fb-7')).toBeNull()
  })
})
