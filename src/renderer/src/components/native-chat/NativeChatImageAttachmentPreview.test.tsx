// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  state: {
    src: 'blob:attachment-preview' as string | undefined,
    status: 'ready' as 'idle' | 'loading' | 'ready' | 'unavailable'
  },
  useLocalImageSrcState: vi.fn()
}))

vi.mock('@/components/editor/useLocalImageSrc', () => ({
  useLocalImageSrcState: (...args: unknown[]) => {
    mocks.useLocalImageSrcState(...args)
    return { ...mocks.state, retry: mocks.retry }
  }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values?.[key] ?? '')
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (store: unknown) => unknown) =>
    selector({
      sshConnectionStates: new Map([['conn-1', { connectionGeneration: 7 }]])
    })
}))

import { NativeChatImageAttachmentPreview } from './NativeChatImageAttachmentPreview'

beforeEach(() => {
  mocks.state.src = 'blob:attachment-preview'
  mocks.state.status = 'ready'
  mocks.retry.mockReset()
  mocks.useLocalImageSrcState.mockReset()
  vi.stubGlobal('IntersectionObserver', undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NativeChatImageAttachmentPreview', () => {
  it('opens a canonical dialog and removes the pending image', () => {
    const onRemove = vi.fn()
    render(
      <TooltipProvider>
        <NativeChatImageAttachmentPreview
          attachment={{ id: 'image-1', path: 'C:\\tmp\\example.png' }}
          onRemove={onRemove}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'View image: example.png' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    // The open dialog aria-hides the thumbnail, so both copies need hidden queries.
    expect(screen.getAllByRole('img', { name: 'example.png', hidden: true })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Remove image: example.png', hidden: true }))
    expect(onRemove).toHaveBeenCalledWith('image-1')
  })

  it('shows loading before declaring a remote preview unavailable', () => {
    mocks.state.src = undefined
    mocks.state.status = 'loading'
    render(
      <TooltipProvider>
        <NativeChatImageAttachmentPreview
          attachment={{ id: 'image-1', path: '/remote/image.png', connectionId: 'conn-1' }}
          onRemove={() => {}}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'View image: image.png' }))
    expect(screen.getByText('Loading image preview…')).toBeTruthy()
    expect(mocks.useLocalImageSrcState).toHaveBeenLastCalledWith(
      '/remote/image.png',
      '/remote/image.png',
      'conn-1',
      undefined,
      7
    )
  })

  it('offers an explicit retry after a preview read fails', () => {
    mocks.state.src = undefined
    mocks.state.status = 'unavailable'
    render(
      <TooltipProvider>
        <NativeChatImageAttachmentPreview
          attachment={{ id: 'image-1', path: '/remote/image.png' }}
          onRemove={() => {}}
        />
      </TooltipProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'View image: image.png' }))
    expect(screen.getByText('Preview unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.retry).toHaveBeenCalledOnce()
  })
})
