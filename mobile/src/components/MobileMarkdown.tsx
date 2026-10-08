import { INLINE_TEXT_SELECTION } from './inline-text-selection'
import { MobileSelectableText } from './MobileSelectableText'
import { Fragment, memo, useContext, useMemo, type ReactNode } from 'react'
import { Pressable, ScrollView, Text as NativeText, View } from 'react-native'
import { styles } from './mobile-markdown-styles'
import {
  MarkdownText,
  MarkdownTextContext,
  openMarkdownHref,
  renderInline,
  type MarkdownTextSetup
} from './mobile-markdown-inline'
import { isMobileMermaidLanguage } from './mobile-mermaid-language'
import { useMobileMarkdownBlocks } from './use-mobile-markdown-blocks'
import type { NativeChatVisualDirective } from '../../../src/shared/native-chat-visual-directive'
import { MermaidDiagram } from './pr-sidebar/MermaidDiagram'
import { translate } from '../i18n/i18n'

type Props = {
  content?: string
  fallback?: string
  /** Enables iOS range selection for native-chat transcript prose. */
  rangeSelectable?: boolean
  /** Forward long presses from interactive Android transcript spans to the message. */
  onLongPress?: () => void
  /** Multiplier for prose font size (paragraphs, lists, quotes). Defaults to 1;
   *  the chat view passes >1 so agent prose reads larger than the compact base. */
  textScale?: number
  /** When provided, detected file paths and file-target hrefs render as tappable
   *  and invoke this with the path text (worktree-relative or absolute, with an
   *  optional :line(:col) suffix). Omitted on screens with no file viewer, where
   *  paths render as plain text (no behavior change). */
  onOpenFile?: (pathText: string) => void
  /** Native-chat assistant prose only: renders `::orca-visual{...}` directive lines. Without it,
   *  a directive line is ordinary text. Must be referentially stable (this component is memoized). */
  renderVisual?: (directive: NativeChatVisualDirective, index: number) => ReactNode
}

const MAX_TABLE_ROWS = 40
const MAX_TABLE_COLUMNS = 8
/** Prose base size — passed to MermaidDiagram fallback mono text. */
const MERMAID_BASE = 13

function MobileMarkdownContent({
  content,
  fallback = '',
  rangeSelectable = false,
  textScale = 1,
  onOpenFile,
  renderVisual
}: Props) {
  // Interactive children own their touches and must forward the row action.
  const setup = useContext(MarkdownTextContext)
  const rowLongPress = setup.androidTranscript ? setup.onLongPress : undefined
  const text = content?.trim() ?? ''
  const { blocks, directives } = useMobileMarkdownBlocks(text, renderVisual !== undefined)
  // Scale prose sizes; inline spans inherit fontSize from the wrapping Text.
  const scaled = (size: number): { fontSize: number; lineHeight: number } | null =>
    textScale !== 1 ? { fontSize: size * textScale, lineHeight: (size + 6) * textScale } : null
  const proseScale = scaled(13)
  const listScale = scaled(14)
  if (!text) {
    return fallback ? (
      <MarkdownText selectable={rangeSelectable} style={styles.paragraph}>
        {fallback}
      </MarkdownText>
    ) : null
  }
  const mermaidSourceOccurrences = new Map<string, number>()
  // Native-chat range selection is set on each block; nested inline spans inherit it.

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => {
        if (block.type === 'visual') {
          const directive = directives[block.index]
          return directive && renderVisual ? (
            <Fragment key={`visual:${block.index}:${directive.file}`}>
              {renderVisual(directive, block.index)}
            </Fragment>
          ) : null
        }
        if (block.type === 'heading') {
          return (
            <MarkdownText
              key={index}
              selectable
              style={[styles.heading, block.level <= 2 ? styles.headingLarge : null]}
            >
              {renderInline(block.text, onOpenFile)}
            </MarkdownText>
          )
        }
        if (block.type === 'quote') {
          return (
            <View key={index} style={styles.quote}>
              <MarkdownText selectable style={styles.quoteText}>
                {renderInline(block.text, onOpenFile)}
              </MarkdownText>
            </View>
          )
        }
        if (block.type === 'code') {
          // Mermaid fences render as diagrams (WebView), not as raw code — same as PR sidebar.
          // Unclosed fences are still streaming: mounting the WebView per tick would
          // reload its document up to 20x/sec, so they stay raw code until terminated.
          if (isMobileMermaidLanguage(block.language) && block.closed) {
            const occurrence = mermaidSourceOccurrences.get(block.text) ?? 0
            mermaidSourceOccurrences.set(block.text, occurrence + 1)
            return (
              <MermaidDiagram
                key={`${block.text}:${occurrence}`}
                source={block.text}
                base={MERMAID_BASE}
              />
            )
          }
          return (
            <View key={index} style={styles.codeBlock}>
              {block.language ? (
                <NativeText style={styles.codeLanguage}>{block.language}</NativeText>
              ) : null}
              <MarkdownText selectable style={styles.codeText}>
                {block.text}
              </MarkdownText>
            </View>
          )
        }
        if (block.type === 'image') {
          return (
            <Pressable
              key={index}
              style={styles.imageFrame}
              onPress={() => openMarkdownHref(block.url, onOpenFile)}
              onLongPress={rowLongPress}
            >
              <NativeText style={styles.link}>
                {block.alt || translate('m.MobileMarkdown.7d36e16e08', 'Open image')}
              </NativeText>
              <NativeText style={styles.imageCaption} numberOfLines={1}>
                {block.url}
              </NativeText>
            </Pressable>
          )
        }
        if (block.type === 'table') {
          const visibleHeaders = block.headers.slice(0, MAX_TABLE_COLUMNS)
          const visibleRows = block.rows.slice(0, MAX_TABLE_ROWS)
          const hiddenRows = Math.max(0, block.rows.length - visibleRows.length)
          const hiddenColumns = Math.max(0, block.headers.length - visibleHeaders.length)
          return (
            <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.table}>
                <View style={styles.tableRow}>
                  {visibleHeaders.map((header, cellIndex) => (
                    <MarkdownText
                      key={cellIndex}
                      selectable
                      style={[styles.tableCell, styles.tableHeader]}
                    >
                      {renderInline(header, onOpenFile)}
                    </MarkdownText>
                  ))}
                </View>
                {visibleRows.map((row, rowIndex) => (
                  <View key={rowIndex} style={styles.tableRow}>
                    {visibleHeaders.map((_, cellIndex) => (
                      <MarkdownText key={cellIndex} selectable style={styles.tableCell}>
                        {renderInline(row[cellIndex] ?? '', onOpenFile)}
                      </MarkdownText>
                    ))}
                  </View>
                ))}
                {hiddenRows > 0 || hiddenColumns > 0 ? (
                  <NativeText style={styles.tableTruncated}>
                    {hiddenRows > 0
                      ? translate('m.MobileMarkdown.26687ede29', '{{value0}} more rows', {
                          value0: hiddenRows
                        })
                      : ''}
                    {hiddenRows > 0 && hiddenColumns > 0 ? ' · ' : ''}
                    {hiddenColumns > 0
                      ? translate('m.MobileMarkdown.9228cc8353', '{{value0}} more columns', {
                          value0: hiddenColumns
                        })
                      : ''}
                  </NativeText>
                ) : null}
              </View>
            </ScrollView>
          )
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listItem}>
                  <NativeText style={styles.listMarker}>
                    {item.checked == null
                      ? block.ordered
                        ? `${itemIndex + 1}.`
                        : '-'
                      : item.checked
                        ? translate('m.MobileMarkdown.cb032ab166', '[x]')
                        : '[ ]'}
                  </NativeText>
                  <MarkdownText selectable style={[styles.listText, listScale]}>
                    {renderInline(item.text, onOpenFile)}
                  </MarkdownText>
                </View>
              ))}
            </View>
          )
        }
        if (block.type === 'rule') {
          return <View key={index} style={styles.rule} />
        }
        return (
          <MarkdownText
            key={index}
            selectable={rangeSelectable}
            style={[styles.paragraph, proseScale]}
          >
            {block.text.split('\n').map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? '\n' : null}
                {renderInline(line, onOpenFile)}
              </Fragment>
            ))}
          </MarkdownText>
        )
      })}
    </View>
  )
}

function MobileMarkdownInner(props: Props): React.JSX.Element | null {
  const { rangeSelectable = false, onLongPress } = props
  // Other Markdown surfaces retain their existing selection behavior.
  const androidTranscript = rangeSelectable && !INLINE_TEXT_SELECTION
  const setup = useMemo<MarkdownTextSetup>(
    () => ({
      TextComponent: rangeSelectable && !androidTranscript ? MobileSelectableText : NativeText,
      androidTranscript,
      ...(onLongPress ? { onLongPress } : {})
    }),
    [rangeSelectable, androidTranscript, onLongPress]
  )
  return (
    <MarkdownTextContext.Provider value={setup}>
      <MobileMarkdownContent {...props} />
    </MarkdownTextContext.Provider>
  )
}

export const MobileMarkdown = memo(MobileMarkdownInner)
