import { StyleSheet, Text, View } from 'react-native'
import type { HomeStatsSummary } from '../stats/home-stats-total'
import { colors, spacing } from '../theme/mobile-theme'
import { translate } from '../i18n/i18n'

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  return totalHours > 0 ? `${totalHours}h ${minutes}m` : `${totalMinutes}m`
}

export function MobileHomeListHeader({ stats }: { stats: HomeStatsSummary | null }) {
  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{translate('m.index.f62e59845a', 'Welcome back')}</Text>
      </View>
      {stats ? (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalAgentsSpawned.toLocaleString()}</Text>
            <Text style={styles.statLabel}>
              {translate('m.index.a8515b5dc4', 'Agents spawned')}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatDuration(stats.totalAgentTimeMs)}</Text>
            <Text style={styles.statLabel}>{translate('m.index.e2e27dc946', 'Agent time')}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalPRsCreated.toLocaleString()}</Text>
            <Text style={styles.statLabel}>{translate('m.index.4cf927c2bb', 'PRs created')}</Text>
          </View>
        </View>
      ) : null}
      <Text style={styles.sectionHeading}>{translate('m.index.f3542b6e7a', 'Desktops')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { paddingTop: spacing.xs, paddingBottom: spacing.md },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3
  },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(26,26,26,0.6)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: spacing.md
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3
  },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '500', marginTop: 2 },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  }
})
