import type { ArtifactWriteRequest } from '../../../../shared/artifacts'
import { sshArtifactSourceKey } from '../../../../shared/artifact-cli-bridge'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { flushPendingEditorChange } from './editor-pending-flush'

export function markdownArtifactSourceKey(file: OpenFile): string {
  const route = file.operationProvenance?.generation.route
  const host = parseExecutionHostId(route?.executionHostId)
  if (host?.kind === 'ssh') {
    return sshArtifactSourceKey(host.targetId, file.filePath)
  }
  if (file.externalSshTargetId) {
    return sshArtifactSourceKey(file.externalSshTargetId, file.filePath)
  }
  if (route && (route.runtimeEnvironmentId || route.executionHostId !== 'local')) {
    return JSON.stringify([
      'editor',
      route.runtimeEnvironmentId ?? null,
      route.executionHostId,
      file.filePath
    ])
  }
  if (file.runtimeEnvironmentId) {
    return JSON.stringify(['editor', file.runtimeEnvironmentId ?? null, 'remote', file.filePath])
  }
  return file.filePath
}

/**
 * Uploads the rendered page, not the markdown.
 *
 * The relay can render markdown, but it renders it with a small hand-written
 * renderer that escapes embedded HTML — so a README whose first lines are a
 * centred title and a row of badges arrived as a paragraph of angle brackets.
 * This app already renders that file correctly, through a pipeline that parses
 * the embedded HTML and sanitizes it, and it is the rendering the author was
 * looking at when they pressed share.
 *
 * So the client renders and the server stores. The relay keeps its renderer for
 * clients that still send markdown; nothing about the wire contract changes.
 */
export async function createMarkdownArtifactRequest(
  file: OpenFile,
  content: string
): Promise<ArtifactWriteRequest> {
  const fileName = basename(file.filePath)
  const { renderMarkdownArtifactDocument } = await import('./markdown-artifact-document')
  return {
    sourceKey: markdownArtifactSourceKey(file),
    content: await renderMarkdownArtifactDocument(content, fileName),
    contentType: 'text/html',
    fileName
  }
}

export function createCurrentMarkdownArtifactRequest(
  file: OpenFile,
  contentFileId: string,
  fallbackContent: string
): Promise<ArtifactWriteRequest> {
  flushPendingEditorChange(contentFileId)
  const content = useAppStore.getState().editorDrafts[contentFileId] ?? fallbackContent
  return createMarkdownArtifactRequest(file, content)
}
