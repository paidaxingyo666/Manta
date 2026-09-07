// @vitest-environment happy-dom

import { EventEmitter } from 'node:events'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import type { NativeFileDropPayload } from '../../../../shared/native-file-drop'
import { useNativeChatFileAttachmentActions } from './use-native-chat-file-attachment-actions'
import {
  clearNativeChatAttachmentCacheForTests,
  readNativeChatAttachmentCache,
  useNativeChatComposerAttachments
} from './use-native-chat-composer-attachments'

const electron = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  getPathForFile: vi.fn((file: File) => `/repro/${file.name}`)
}))

vi.mock('electron', () => ({
  ipcRenderer: electron,
  webUtils: { getPathForFile: electron.getPathForFile }
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({ isRemoteRuntimePtyId: () => false }))

import {
  installNativeFileDropHandlers,
  subscribeNativeFileDrop
} from '../../../../preload/preload-runtime-support'

// Uses the production drop listener, subscriber fan-out, attachment hook, and scope cache.
function ComposerProbe({ pane, hidden = false }: { pane: string; hidden?: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useNativeChatComposerAttachments({
    attachmentScopeKey: pane,
    allowWithoutTarget: true,
    caret: 0,
    disabled: false,
    isComposing: () => false,
    resolveTarget: () => null,
    textareaRef,
    setCaret: () => {},
    setDraft: () => {},
    setNotice: () => {}
  })
  useNativeChatFileAttachmentActions(attachments.attachResolvedPaths)
  return (
    <div data-pane={pane} style={{ display: hidden ? 'none' : 'block' }}>
      <textarea ref={textareaRef} data-native-file-drop-target="composer" />
      <output>{JSON.stringify(attachments.imageAttachments.map(({ path }) => path))}</output>
    </div>
  )
}

function dropTwoImages(target: Element): void {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: [new File(['a'], 'first.png'), new File(['b'], 'second.png')]
    }
  })
  act(() => target.dispatchEvent(event))
}

describe('cross-pane image-drop reproduction (asserts the current bug)', () => {
  beforeAll(() => {
    const ipc = new EventEmitter()
    electron.on.mockImplementation((channel, listener) => ipc.on(channel, listener))
    electron.removeListener.mockImplementation((channel, listener) =>
      ipc.removeListener(channel, listener)
    )
    // Mirror registerFileDropRelay: one window-wide notification per valid drop.
    electron.send.mockImplementation((channel: string, payload: NativeFileDropPayload) => {
      if (channel === 'terminal:file-dropped-from-preload') {
        ipc.emit('terminal:file-drop', {}, payload)
      }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { onFileDrop: subscribeNativeFileDrop } }
    })
    installNativeFileDropHandlers()
  })

  afterEach(() => {
    cleanup()
    clearNativeChatAttachmentCacheForTests()
    electron.send.mockClear()
  })

  it('adds both images to an untouched hidden pane and restores them on remount', () => {
    const view = render(
      <>
        <ComposerProbe pane="chat-a" />
        <ComposerProbe pane="chat-b" hidden />
      </>
    )
    expect(readNativeChatAttachmentCache('chat-a')).toEqual([])
    expect(readNativeChatAttachmentCache('chat-b')).toEqual([])

    const target = view.container.querySelector('[data-pane="chat-a"] textarea')!
    dropTwoImages(target)

    expect(electron.send).toHaveBeenCalledExactlyOnceWith('terminal:file-dropped-from-preload', {
      target: 'composer',
      paths: ['/repro/first.png', '/repro/second.png']
    })
    for (const pane of ['chat-a', 'chat-b']) {
      expect(readNativeChatAttachmentCache(pane).map(({ path }) => path)).toEqual([
        '/repro/first.png',
        '/repro/second.png'
      ])
    }

    view.unmount()
    const returned = render(<ComposerProbe pane="chat-b" />)
    expect(returned.container.querySelector('output')?.textContent).toBe(
      '["/repro/first.png","/repro/second.png"]'
    )
  })

  it('control: an editor-targeted drop does not attach images to either chat', () => {
    const view = render(
      <>
        <ComposerProbe pane="chat-a" />
        <ComposerProbe pane="chat-b" hidden />
        <div data-native-file-drop-target="editor" />
      </>
    )
    dropTwoImages(view.container.querySelector('[data-native-file-drop-target="editor"]')!)
    expect(electron.send).toHaveBeenCalledExactlyOnceWith('terminal:file-dropped-from-preload', {
      target: 'editor',
      paths: ['/repro/first.png', '/repro/second.png']
    })
    expect(readNativeChatAttachmentCache('chat-a')).toEqual([])
    expect(readNativeChatAttachmentCache('chat-b')).toEqual([])
  })
})
