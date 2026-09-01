import { readFileSync } from 'node:fs'

const SOURCE_FILES = [
  './terminal-webview-html.ts',
  './terminal-webview-html/document-shell.ts',
  './terminal-webview-html/runtime-state-and-text-scaling.ts',
  './terminal-webview-html/fit-scale-and-write-queue.ts',
  './terminal-webview-html/terminal-init-and-write.ts',
  './terminal-webview-html/host-message-router.ts',
  './terminal-webview-html/selection-state-and-eviction.ts',
  './terminal-webview-html/term-observers-and-mode-mirroring.ts',
  './terminal-webview-html/mouse-report-and-scroll-routing.ts',
  './terminal-webview-html/smooth-scroll-and-cell-geometry.ts',
  './terminal-webview-html/selection-overlay.ts',
  './terminal-webview-html/surface-touch-gestures.ts',
  './terminal-webview-html/message-bridge-and-document-close.ts'
] as const

/** Reads the TypeScript source that assembles the in-WebView document. */
export function readTerminalWebViewHtmlSource(): string {
  return SOURCE_FILES.map((relativePath) =>
    readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  ).join('\n')
}
