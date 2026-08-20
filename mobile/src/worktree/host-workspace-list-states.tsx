import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import {
  selectHostWorkspaceListState,
  type HostWorkspaceListStateInput
} from './host-workspace-list-state'
import { translate } from '../i18n/i18n'

export function HostWorkspaceListStates(
  props: HostWorkspaceListStateInput & {
    search: string
    activeFilterCount: number
  }
) {
  const state = selectHostWorkspaceListState(props)
  if (state === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (state === 'catalog-error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          {translate(
            'auto.mobile.src.worktree.host.workspace.list.states.9f6f3e7d1c',
            'Could not load workspaces from this host'
          )}
        </Text>
        <Text style={styles.catalogErrorDetail}>
          {translate(
            'auto.mobile.src.worktree.host.workspace.list.states.26afe48a65',
            'worktree.ps failed ({{value0}}) — retrying automatically',
            { value0: props.catalogError }
          )}
        </Text>
      </View>
    )
  }
  if (state === 'empty') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          {props.search
            ? translate(
                'auto.mobile.src.worktree.host.workspace.list.states.4b6ffdb276',
                'No matching worktrees'
              )
            : props.activeFilterCount > 0
              ? translate(
                  'auto.mobile.src.worktree.host.workspace.list.states.3d19717048',
                  'No worktrees match filters'
                )
              : translate(
                  'auto.mobile.src.worktree.host.workspace.list.states.5c9a3d6268',
                  'No worktrees'
                )}
        </Text>
      </View>
    )
  }
  return null
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  catalogErrorDetail: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    color: colors.textMuted,
    fontSize: typography.metaSize,
    textAlign: 'center'
  }
})
