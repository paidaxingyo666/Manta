import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import {
  createCurrentMarkdownArtifactRequest,
  createMarkdownArtifactRequest,
  markdownArtifactSourceKey
} from './markdown-artifact-upload'

const mocks = vi.hoisted(() => ({
  drafts: {} as Record<string, string>,
  flush: vi.fn(),
  settings: undefined as unknown,
  worktreesByRepo: {} as Record<string, unknown[]>
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      editorDrafts: mocks.drafts,
      settings: mocks.settings,
      folderWorkspaces: [],
      worktreesByRepo: mocks.worktreesByRepo
    })
  }
}))
vi.mock('./editor-pending-flush', () => ({
  flushPendingEditorChange: mocks.flush
}))

beforeEach(() => {
  mocks.drafts = {}
  mocks.worktreesByRepo = {}
  mocks.flush.mockReset()
})

function openFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/notes.md',
    filePath: '/repo/notes.md',
    relativePath: 'notes.md',
    worktreeId: 'worktree-1',
    language: 'markdown',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('Markdown artifact upload', () => {
  it('uses the ordinary file path for local and folder workspaces', async () => {
    expect(markdownArtifactSourceKey(openFile())).toBe('/repo/notes.md')
    const request = await createMarkdownArtifactRequest(openFile(), '# Draft')
    expect(request).toMatchObject({
      sourceKey: '/repo/notes.md',
      contentType: 'text/html',
      fileName: 'notes.md'
    })
    // rehype-slug adds the anchor id, same as the preview does.
    expect(request.content).toContain('>Draft</h1>')
  })

  it('renders the embedded HTML a README opens with, rather than escaping it', async () => {
    // The relay's own renderer escapes raw HTML, so a centred title and a row
    // of badges arrived as a paragraph of angle brackets. This app already
    // parses and sanitizes that HTML for the preview; sharing now carries what
    // the preview showed.
    const readme = [
      '<h1 align="center">',
      '<a href="https://example.com"><img src="https://example.com/i.png" alt="Icon" /></a> Title',
      '</h1>',
      '',
      '**Body text.**'
    ].join('\n')
    const request = await createMarkdownArtifactRequest(openFile(), readme)
    expect(request.content).toContain('<h1')
    expect(request.content).toContain('<img')
    expect(request.content).toContain('<strong>Body text.</strong>')
    expect(request.content).not.toContain('&lt;h1')
  })

  it('drops file: URLs, which would publish paths from the author machine', async () => {
    const request = await createMarkdownArtifactRequest(
      openFile(),
      '[local](file:///Users/someone/secret/notes.md)'
    )
    expect(request.content).not.toContain('file:///Users/someone')
  })

  it('isolates source identity by runtime owner', () => {
    const file = openFile({
      runtimeEnvironmentId: 'server-1',
      operationProvenance: {
        ownershipProjection: 'explicit',
        generation: {
          route: {
            runtimeEnvironmentId: 'server-1',
            executionHostId: 'ssh:build-box'
          },
          runtimeConnectionGeneration: 1,
          runtimePairingRevision: 1,
          runtimeSshGeneration: 1,
          nestedSshGeneration: 1,
          directSshGeneration: null
        }
      }
    })
    expect(JSON.parse(markdownArtifactSourceKey(file))).toEqual([
      'ssh',
      'build-box',
      '/repo/notes.md'
    ])
  })

  it('matches the SSH CLI source identity for external files', () => {
    expect(
      JSON.parse(markdownArtifactSourceKey(openFile({ externalSshTargetId: 'build-box' })))
    ).toEqual(['ssh', 'build-box', '/repo/notes.md'])
  })

  it('flushes and reads the latest unsaved editor buffer', async () => {
    mocks.flush.mockImplementation((fileId: string) => {
      mocks.drafts[fileId] = '# Latest edit'
    })

    // The upload carries the rendered page now, so the buffer is checked
    // through what it rendered into rather than by comparing the source.
    const request = await createCurrentMarkdownArtifactRequest(
      openFile(),
      '/repo/notes.md',
      '# Stale content'
    )
    expect(request.contentType).toBe('text/html')
    expect(request.content).toContain('Latest edit')
    expect(request.content).not.toContain('Stale content')
    expect(mocks.flush).toHaveBeenCalledWith('/repo/notes.md')
  })
})
