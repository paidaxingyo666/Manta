// @vitest-environment happy-dom

import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  getVersion: vi.fn(),
  openUrl: vi.fn()
}))

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react')
  const Section = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DialogContent: ReactModule.forwardRef<
      HTMLDivElement,
      React.HTMLAttributes<HTMLDivElement> & {
        children?: ReactNode
        onOpenAutoFocus?: (event: Event) => void
      }
    >(function DialogContent({ children, onOpenAutoFocus: _onOpenAutoFocus, ...props }, ref) {
      return (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    }),
    DialogDescription: Section,
    DialogFooter: Section,
    DialogHeader: Section,
    DialogTitle: Section
  }
})

import { SidebarFeedbackDialog } from './SidebarFeedbackDialog'

const SUBMIT = 'Open a GitHub issue'

beforeEach(() => {
  mocks.getPlatform.mockReset()
  mocks.getVersion.mockReset()
  mocks.openUrl.mockReset()
  mocks.getPlatform.mockReturnValue({
    platform: 'darwin',
    osRelease: '25.0.0',
    arch: 'arm64',
    shell: '/bin/zsh',
    displayServer: null
  })
  mocks.getVersion.mockResolvedValue('1.4.189-rc.0')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      shell: { openUrl: mocks.openUrl },
      platform: { get: mocks.getPlatform },
      updater: { getVersion: mocks.getVersion }
    }
  })
})

afterEach(() => {
  cleanup()
})

function openDialog(): HTMLTextAreaElement {
  render(<SidebarFeedbackDialog open onOpenChange={vi.fn()} />)
  return screen.getByPlaceholderText('What could we improve?') as HTMLTextAreaElement
}

describe('SidebarFeedbackDialog environment prefill', () => {
  it('pre-inserts Manta version and OS info when the dialog opens', async () => {
    const textarea = openDialog()

    await waitFor(() => {
      expect(textarea.value).toContain('Manta: 1.4.189-rc.0')
      expect(textarea.value).toContain('OS: darwin 25.0.0 (arm64)')
      expect(textarea.value).toContain('Shell: /bin/zsh')
    })
    // The footer alone is not a report.
    expect((screen.getByRole('button', { name: SUBMIT }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps version info when the user types above the prefilled block', async () => {
    const textarea = openDialog()
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))

    fireEvent.change(textarea, { target: { value: `Terminal hangs.\n${textarea.value}` } })

    expect(textarea.value).toContain('Terminal hangs.')
    expect(textarea.value).toContain('Manta: 1.4.189-rc.0')
  })

  it('allows a report once the user writes below the footer', async () => {
    const textarea = openDialog()
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))

    fireEvent.change(textarea, { target: { value: `${textarea.value}\nSteps: open a worktree.` } })

    expect((screen.getByRole('button', { name: SUBMIT }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('SidebarFeedbackDialog issue handoff', () => {
  it('says the build has no feedback server', () => {
    openDialog()

    expect(screen.getByText(/no feedback server/i)).toBeTruthy()
  })

  it('carries the typed report and the version footer into the issue body', async () => {
    const onOpenChange = vi.fn()
    render(<SidebarFeedbackDialog open onOpenChange={onOpenChange} />)
    const textarea = screen.getByPlaceholderText('What could we improve?') as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))
    fireEvent.change(textarea, { target: { value: `Crashes on quit.\n${textarea.value}` } })

    fireEvent.click(screen.getByRole('button', { name: SUBMIT }))

    const url = mocks.openUrl.mock.calls[0][0] as string
    // template= is load-bearing: this repo disables blank issues, so a bare
    // ?body= lands on the chooser with the text dropped.
    expect(
      url.startsWith(
        'https://github.com/paidaxingyo666/Manta/issues/new?template=other.yml&details='
      )
    ).toBe(true)
    const body = decodeURIComponent(url.split('&details=')[1])
    expect(body).toContain('Crashes on quit.')
    expect(body).toContain('Manta: 1.4.189-rc.0')
    // Nothing is left behind to submit, so the dialog closes with the handoff.
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // `open` refuses a URL past a few thousand characters and GitHub answers 414,
  // so a pasted log has to be cut. A silently dead button would be worse.
  it('truncates a report too long to survive the URL', async () => {
    const textarea = openDialog()
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))
    fireEvent.change(textarea, { target: { value: 'x'.repeat(9000) } })

    fireEvent.click(screen.getByRole('button', { name: SUBMIT }))

    const encoded = (mocks.openUrl.mock.calls[0][0] as string).split('&details=')[1]
    expect(encoded.length).toBeLessThanOrEqual(6000)
    expect(decodeURIComponent(encoded)).toContain('truncated')
  })

  // Percent-encoding is where a report gets big: one CJK character costs three
  // bytes, so a Chinese report hits the URL limit ~9x sooner than an English
  // one of the same length.
  it('budgets a CJK report by encoded bytes, not characters', async () => {
    const textarea = openDialog()
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))
    fireEvent.change(textarea, { target: { value: '终端卡死'.repeat(1000) } })

    fireEvent.click(screen.getByRole('button', { name: SUBMIT }))

    expect(
      (mocks.openUrl.mock.calls[0][0] as string).split('&details=')[1].length
    ).toBeLessThanOrEqual(6000)
  })

  // Slicing between the halves of a surrogate pair makes encodeURIComponent
  // throw URIError, which the user sees as a button that does nothing.
  it('never cuts a surrogate pair in half', async () => {
    const textarea = openDialog()
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))
    fireEvent.change(textarea, { target: { value: '🐛'.repeat(3000) } })

    expect(() => fireEvent.click(screen.getByRole('button', { name: SUBMIT }))).not.toThrow()
    expect(mocks.openUrl).toHaveBeenCalled()
  })

  it('never reaches a feedback endpoint', async () => {
    const textarea = openDialog()
    await waitFor(() => expect(textarea.value).toContain('Manta: 1.4.189-rc.0'))
    fireEvent.change(textarea, { target: { value: `Report.\n${textarea.value}` } })

    fireEvent.click(screen.getByRole('button', { name: SUBMIT }))

    expect((window.api as Record<string, unknown>).feedback).toBeUndefined()
  })
})
