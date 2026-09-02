import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Loader2, RefreshCw, X } from 'lucide-react'

import { useLocalImageSrcState } from '@/components/editor/useLocalImageSrc'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import { isNativeChatPastedImagePath } from './native-chat-image-paste'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'

type Props = {
  attachment: NativeChatComposerImageAttachment
  onRemove: (id: string) => void
}

/** Previews a pending image without crossing its recorded SSH owner. */
export function NativeChatImageAttachmentPreview({
  attachment,
  onRemove
}: Props): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [isNearViewport, setIsNearViewport] = useState(false)
  const thumbnailRef = useRef<HTMLDivElement>(null)
  const connectionGeneration = useAppStore((store) =>
    attachment.connectionId
      ? store.sshConnectionStates.get(attachment.connectionId)?.connectionGeneration
      : undefined
  )

  useEffect(() => {
    const element = thumbnailRef.current
    if (!element) {
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: '128px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const preview = useLocalImageSrcState(
    isNearViewport || isOpen ? attachment.path : undefined,
    attachment.path,
    attachment.connectionId,
    undefined,
    connectionGeneration
  )
  const filename = isNativeChatPastedImagePath(attachment.path)
    ? translate('components.native-chat.composer.pastedImageLabel', 'Pasted image')
    : basename(attachment.path)
  const viewLabel = translate(
    'components.native-chat.composer.viewAttachment',
    'View image: {{value0}}',
    { value0: filename }
  )
  const removeLabel = translate(
    'components.native-chat.composer.removeNamedAttachment',
    'Remove image: {{value0}}',
    { value0: filename }
  )

  return (
    <>
      <div ref={thumbnailRef} className="relative size-14 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label={viewLabel}
              onClick={() => setIsOpen(true)}
              className="size-14 overflow-hidden p-0"
            >
              {preview.src ? (
                <img src={preview.src} alt={filename} className="size-full object-cover" />
              ) : preview.status === 'loading' ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ImageIcon className="size-5 text-muted-foreground" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {viewLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label={removeLabel}
              onClick={() => onRemove(attachment.id)}
              className="absolute -right-2 -top-2 rounded-full text-muted-foreground opacity-80 hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {removeLabel}
          </TooltipContent>
        </Tooltip>
      </div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col gap-3 border-border bg-background p-3 sm:max-w-4xl">
          <DialogTitle className="truncate text-sm">{filename}</DialogTitle>
          <DialogDescription className="sr-only">
            {translate('components.native-chat.composer.imagePreview', 'Full-size image preview')}
          </DialogDescription>
          <div className="scrollbar-sleek flex min-h-0 items-center justify-center overflow-auto rounded-md bg-muted/20 p-2">
            {preview.src ? (
              <img
                src={preview.src}
                alt={filename}
                className="max-h-[75vh] max-w-full object-contain"
              />
            ) : preview.status === 'loading' ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {translate(
                  'components.native-chat.composer.imagePreviewLoading',
                  'Loading image preview…'
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
                <span>
                  {translate(
                    'components.native-chat.composer.imagePreviewUnavailable',
                    'Preview unavailable'
                  )}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={preview.retry}>
                  <RefreshCw className="size-4" />
                  {translate('components.native-chat.composer.retryImagePreview', 'Retry')}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
