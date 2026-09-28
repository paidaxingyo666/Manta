import { memo, type ComponentType } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import {
  Bold,
  Code2,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
  Strikethrough
} from 'lucide-react-native'
import { translate } from '../i18n/i18n'
import { localizedConstant } from '../i18n/localized-constant'
import { colors, radii, spacing } from '../theme/mobile-theme'
import type { MobileRichMarkdownCommand } from './mobile-rich-markdown-editor-contract'

type ToolbarItem = {
  command: MobileRichMarkdownCommand
  icon: ComponentType<{ size?: number; color?: string }>
}

/**
 * The fifteen commands, in the order they are pressed in.
 *
 * Shared rather than declared twice because both surfaces drive the same document: inside the
 * WebView the press becomes an injected `runCommand` and on the page it is a call, but the row of
 * controls is the same row and a command added to the contract has to appear on both.
 */
const TOOLBAR_ITEMS: ToolbarItem[] = [
  { command: 'paragraph', icon: Pilcrow },
  { command: 'heading1', icon: Heading1 },
  { command: 'heading2', icon: Heading2 },
  { command: 'heading3', icon: Heading3 },
  { command: 'bold', icon: Bold },
  { command: 'italic', icon: Italic },
  { command: 'strike', icon: Strikethrough },
  { command: 'bulletList', icon: List },
  { command: 'orderedList', icon: ListOrdered },
  { command: 'taskList', icon: ListTodo },
  { command: 'quote', icon: Quote },
  { command: 'link', icon: Link },
  { command: 'image', icon: ImageIcon },
  { command: 'inlineCode', icon: Code2 },
  { command: 'codeBlock', icon: FileCode2 }
]

// Why apart from TOOLBAR_ITEMS: labels must re-read on language change, while the command list is
// exported at import time. The Record keeps a label mandatory for every contract command.
const toolbarLabels = localizedConstant((): Record<MobileRichMarkdownCommand, string> => ({
  paragraph: translate('m.MobileRichMarkdownEditor.dcf876bee3', 'Body'),
  heading1: translate('m.MobileRichMarkdownEditor.4e4c3e5c6e', 'H1'),
  heading2: translate('m.MobileRichMarkdownEditor.4f4fb498bc', 'H2'),
  heading3: translate('m.MobileRichMarkdownEditor.aa920b1281', 'H3'),
  bold: translate('m.MobileRichMarkdownEditor.4dc5087c78', 'Bold'),
  italic: translate('m.MobileRichMarkdownEditor.cf0a148dc5', 'Italic'),
  strike: translate('m.MobileRichMarkdownEditor.c307647887', 'Strike'),
  bulletList: translate('m.MobileRichMarkdownEditor.84ac880fd0', 'Bullet list'),
  orderedList: translate('m.MobileRichMarkdownEditor.ffbf532ba2', 'Numbered list'),
  taskList: translate('m.MobileRichMarkdownEditor.8cf9508628', 'Checklist'),
  quote: translate('m.MobileRichMarkdownEditor.750393eed3', 'Quote'),
  link: translate('m.MobileRichMarkdownEditor.78b02d6409', 'Link'),
  image: translate('m.MobileRichMarkdownEditor.7d3dcdfd44', 'Image'),
  inlineCode: translate('m.MobileRichMarkdownEditor.8758a483e2', 'Inline code'),
  codeBlock: translate('m.MobileRichMarkdownEditor.b0b327b090', 'Code block')
}))

/** The commands alone, for a caller that drives the row rather than renders it. */
export const MOBILE_RICH_MARKDOWN_TOOLBAR_COMMANDS = TOOLBAR_ITEMS.map((item) => item.command)

export const MobileRichMarkdownToolbar = memo(function MobileRichMarkdownToolbar({
  editable,
  onCommand
}: {
  editable: boolean
  onCommand: (command: MobileRichMarkdownCommand) => void
}) {
  const labels = toolbarLabels()
  return (
    <View style={styles.toolbar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarContent}
        keyboardShouldPersistTaps="handled"
      >
        {TOOLBAR_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <Pressable
              key={item.command}
              disabled={!editable}
              accessibilityRole="button"
              accessibilityLabel={labels[item.command]}
              onPress={() => onCommand(item.command)}
              style={({ pressed }) => [
                styles.toolbarButton,
                pressed && editable ? styles.toolbarButtonPressed : null,
                !editable ? styles.toolbarButtonDisabled : null
              ]}
            >
              <Icon size={15} color={editable ? colors.textPrimary : colors.textMuted} />
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
})

const styles = StyleSheet.create({
  toolbar: {
    minHeight: 42,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  toolbarContent: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6
  },
  toolbarButton: {
    minWidth: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    paddingHorizontal: spacing.xs
  },
  toolbarButtonPressed: {
    backgroundColor: colors.bgRaised
  },
  toolbarButtonDisabled: {
    opacity: 0.55
  }
})
