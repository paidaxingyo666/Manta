import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { X } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { BottomDrawer } from '../components/BottomDrawer'
import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import { mobileDiffLineNumber, mobileDiffLinePrefix } from './mobile-diff-format'
import type { MobileBranchDiffPreviewState } from './mobile-source-control-screen-state'
import { styles } from './mobile-source-control-styles'
import { translate } from '../i18n/i18n'

type Props = {
  branchDiffPreview: MobileBranchDiffPreviewState | null
  onClose: () => void
}

export function MobileBranchDiffPreviewDrawer({ branchDiffPreview, onClose }: Props) {
  if (!branchDiffPreview) {
    return null
  }
  const entry = branchDiffPreview.entry
  return (
    <BottomDrawer
      visible={branchDiffPreview !== null}
      onClose={onClose}
      dragContentToDismiss={false}
      zIndex={1100}
    >
      <View style={styles.diffDrawerHeader}>
        <View style={styles.diffDrawerTitleBlock}>
          <Text style={styles.diffDrawerTitle} numberOfLines={1}>
            {entry.path}
          </Text>
          <Text style={styles.diffDrawerMeta} numberOfLines={1}>
            {branchDiffPreview.kind === 'ready'
              ? translate('m.MobileBranchDiffPreviewDrawer.ea5ca6f964', '{{value0}}..HEAD', {
                  value0: branchDiffPreview.summary.baseRef
                })
              : translate('m.MobileBranchDiffPreviewDrawer.23a1a340ef', 'Committed on branch')}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.diffCloseButton, pressed && styles.iconButtonPressed]}
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="Close committed diff preview"
        >
          <X size={18} color={colors.textSecondary} strokeWidth={2.1} />
        </Pressable>
      </View>
      {branchDiffPreview.kind === 'loading' ? (
        <View style={styles.diffState}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : branchDiffPreview.kind === 'error' ? (
        <View style={styles.diffState}>
          <Text style={styles.stateTitle}>
            {translate('m.MobileBranchDiffPreviewDrawer.9998f95c16', 'Unable to Load Diff')}
          </Text>
          <Text style={styles.stateText}>{branchDiffPreview.message}</Text>
        </View>
      ) : (
        <View style={styles.diffLines}>
          {branchDiffPreview.truncated ? (
            <Text style={styles.diffTruncatedText}>
              {translate(
                'm.MobileBranchDiffPreviewDrawer.0a05486f61',
                'Diff truncated for mobile preview.'
              )}
            </Text>
          ) : null}
          {branchDiffPreview.lines.map((line, index) => (
            <View
              key={`${index}:${line.kind}:${line.oldLineNumber ?? ''}:${line.newLineNumber ?? ''}`}
              style={[
                styles.diffLine,
                line.kind === 'add' && styles.diffLineAdd,
                line.kind === 'delete' && styles.diffLineDelete
              ]}
            >
              <Text style={styles.diffLineNumber}>{mobileDiffLineNumber(line)}</Text>
              <Text style={styles.diffLinePrefix}>{mobileDiffLinePrefix(line.kind)}</Text>
              <Text style={styles.diffLineText}>
                {line.text ? <MobileSyntaxSegments segments={line.segments} /> : ' '}
              </Text>
            </View>
          ))}
        </View>
      )}
    </BottomDrawer>
  )
}
