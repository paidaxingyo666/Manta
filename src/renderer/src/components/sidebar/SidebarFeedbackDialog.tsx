import React, { useRef, useState } from 'react'
import { ExternalLink, Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { stripClientEnvironmentFooter } from '../../../../shared/client-environment-info'
import { useSidebarFeedbackEnvironmentPrefill } from './use-sidebar-feedback-environment-prefill'

// This fork runs no feedback service, so the report has to travel as a GitHub
// issue. Discord and X are upstream's; sending this fork's users there is
// sending them to someone else's support queue.
//
// `template=` is required, not cosmetic: this repo sets blank_issues_enabled
// false and ships YAML issue forms, so /issues/new?body= is redirected to the
// template chooser and the body is dropped on the way. A form prefills by field
// id instead, and `other.yml` has exactly one — `details`.
const GITHUB_ISSUE_URL = 'https://github.com/paidaxingyo666/Manta/issues/new?template=other.yml'

/**
 * `open` chokes on very long URLs and GitHub answers 414. The budget is on the
 * *encoded* length because percent-encoding is where a report actually gets
 * big: one CJK character is three bytes, so nine characters of Chinese cost as
 * much URL as one line of English.
 */
const MAX_PREFILLED_BODY_BYTES = 6000

/**
 * Trims to a byte budget without splitting a surrogate pair — slicing between
 * the halves of an emoji makes encodeURIComponent throw URIError, which reads
 * as a button that does nothing.
 */
function prefilledIssueBody(report: string): string {
  let text = report.trim()
  while (encodeURIComponent(text).length > MAX_PREFILLED_BODY_BYTES) {
    const next = Math.max(0, text.length - Math.ceil(text.length / 8))
    text = text.slice(0, next)
    const lastCode = text.charCodeAt(text.length - 1)
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      text = text.slice(0, -1)
    }
  }
  return text === report.trim() ? text : `${text}\n\n…（内容过长已截断 / truncated）`
}

type SidebarFeedbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function openExternalUrl(url: string): void {
  void window.api.shell.openUrl(url)
}

export function SidebarFeedbackDialog({
  open,
  onOpenChange
}: SidebarFeedbackDialogProps): React.JSX.Element {
  const [feedback, setFeedback] = useState('')
  const mountedRef = useMountedRef()
  const feedbackTextareaRef = useRef<HTMLTextAreaElement>(null)

  useSidebarFeedbackEnvironmentPrefill({
    open,
    feedback,
    setFeedback,
    textareaRef: feedbackTextareaRef,
    mountedRef
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          feedbackTextareaRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('auto.components.sidebar.SidebarFeedbackDialog.0eb643f07f', 'Send Feedback')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.sidebar.SidebarFeedbackDialog.a828fa4aee',
              "Share what's working, what's broken, or what Manta should do next."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
          {translate(
            'auto.components.sidebar.SidebarFeedbackDialog.selfHostedNotice',
            'This self-hosted build has no feedback server. What you type here — plus the version details below — is carried into a GitHub issue instead. Screenshots can be dropped onto the GitHub page.'
          )}
        </div>

        <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 p-3">
          <div className="text-xs font-medium text-foreground">
            {translate(
              'auto.components.sidebar.SidebarFeedbackDialog.9b33530b3d',
              'Other ways to reach us'
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => openExternalUrl('https://github.com/paidaxingyo666/Manta/issues')}
            >
              <Github className="size-3.5" />
              {translate(
                'auto.components.sidebar.SidebarFeedbackDialog.d245c4ef6c',
                'GitHub issues'
              )}
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
        </div>

        <textarea
          ref={feedbackTextareaRef}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder={translate(
            'auto.components.sidebar.SidebarFeedbackDialog.d46ddd66fc',
            'What could we improve?'
          )}
          rows={7}
          className="min-h-32 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate('auto.components.sidebar.SidebarFeedbackDialog.8bf619e4cf', 'Cancel')}
          </Button>
          <Button
            onClick={() => {
              // The typed report and the version footer travel in the issue
              // body, which is the only part of this dialog still worth having
              // once there is no server to send it to.
              openExternalUrl(
                `${GITHUB_ISSUE_URL}&details=${encodeURIComponent(prefilledIssueBody(feedback))}`
              )
              onOpenChange(false)
            }}
            disabled={stripClientEnvironmentFooter(feedback).trim() === ''}
          >
            {translate(
              'auto.components.sidebar.SidebarFeedbackDialog.openGitHubIssue',
              'Open a GitHub issue'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
