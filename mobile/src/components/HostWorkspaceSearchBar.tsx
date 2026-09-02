import { StyleSheet, View } from 'react-native'
import { MobileSearchField } from './MobileSearchField'
import { translate } from '../i18n/i18n'
import { colors, spacing } from '../theme/mobile-theme'

type HostWorkspaceSearchBarProps = {
  value: string
  onChangeText: (text: string) => void
}

export function HostWorkspaceSearchBar({
  value,
  onChangeText
}: HostWorkspaceSearchBarProps): React.JSX.Element {
  return (
    <View style={styles.searchBar}>
      <MobileSearchField
        value={value}
        onChangeText={onChangeText}
        placeholder={translate('m.index.4e1194291f', 'Search worktrees…')}
        autoFocus
        accessibilityLabel="Search worktrees"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  searchBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  }
})
