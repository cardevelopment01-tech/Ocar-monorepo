import { RefreshControl, StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Button, EmptyState, ErrorState, Skeleton, colors, spacing, typography, fonts, sectionLabel, useNavClearance, Text } from '@ocar/mobile-shared'
import { useTripHistory } from '@/features/earnings/useTripHistory'
import { TripRow } from '@/features/earnings/TripRow'
import { PeriodTabs } from '@/features/earnings/components/PeriodTabs'
import { EarningsBarChart } from '@/features/earnings/components/EarningsBarChart'
import { EarningsBreakdown } from '@/features/earnings/components/EarningsBreakdown'

const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => i)
const PERIOD_LABEL = { today: 'Today', week: 'This Week', month: 'This Month' } as const

export default function EarningsScreen() {
  const { trips, summary, summaryFailed, retrySummary, period, setPeriod, loading, refreshing, loadingMore, summaryLoading, hasMore, error, refresh, loadMore } = useTripHistory()
  const insets = useSafeAreaInsets()
  const clearance = useNavClearance()

  if (loading) {
    return (
      <View style={[styles.screen, styles.content, { paddingTop: insets.top, paddingBottom: clearance }]}>
        {SKELETON_ROWS.map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton height={80} borderRadius={16} />
          </View>
        ))}
      </View>
    )
  }

  if (error && trips.length === 0) {
    return (
      <View style={[styles.centerContainer, styles.screen, { paddingTop: insets.top }]}>
        <ErrorState message={error} onRetry={refresh} />
      </View>
    )
  }

  return (
    <FlashList
      style={styles.screen}
      data={trips}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <TripRow item={item} />}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: clearance }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <EmptyState title="No trips yet" description="Go online to start accepting rides" />
        </View>
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <PeriodTabs value={period} onChange={setPeriod} />

          <LinearGradient colors={['#0B4A50', '#0E8FA3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.summaryCard, summaryLoading ? styles.summaryLoading : null]}>
            <Text style={styles.summaryLabel}>{PERIOD_LABEL[period]}</Text>
            <Text style={styles.summaryTotal}>{summary ? `₹${summary.totalEarnings.toLocaleString('en-IN')}` : '—'}</Text>
            <View style={styles.pillRow}>
              <View style={styles.pill}><Text style={styles.pillText}>{summary ? summary.tripCount : '—'} trips</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>{summary ? summary.onlineHours : '—'} online</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>★ {summary?.rating ?? '-'}</Text></View>
            </View>
          </LinearGradient>

          {summaryFailed ? (
            <View style={styles.summaryError}>
              <Text style={styles.summaryErrorText}>Couldn't load these figures.</Text>
              <Button label="Retry" variant="secondary" onPress={retrySummary} />
            </View>
          ) : null}

          {summary ? <EarningsBarChart values={summary.chart} labels={summary.chartLabels} /> : null}
          {summary ? <EarningsBreakdown breakdown={summary.breakdown} /> : null}

          <Text style={styles.recentLabel}>Recent Trips</Text>
        </View>
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.skeletonRow}>
            <Skeleton height={80} borderRadius={16} />
          </View>
        ) : !hasMore && trips.length > 0 ? (
          <Text style={styles.endText}>That's all your trips</Text>
        ) : null
      }
    />
  )
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.bg },
  content: { paddingVertical: spacing.md },
  centerContainer: { flex: 1, justifyContent: 'center' },
  skeletonRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  header: { paddingHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.sm },
  emptyWrap: { paddingHorizontal: spacing.lg },
  // hero card: deep teal, white type, the one dark surface on an otherwise pale screen
  summaryCard: { gap: spacing.xs, borderRadius: 22, padding: spacing.lg, boxShadow: '0 12px 28px rgba(14,143,163,0.28)' },
  summaryLoading: { opacity: 0.6 },
  summaryError: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  summaryErrorText: { ...typography.caption, color: colors.error },
  summaryLabel: { ...typography.label, color: 'rgba(255,255,255,0.72)' },
  summaryTotal: { ...typography.display, color: '#FFFFFF', fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  pillText: { ...typography.caption, color: '#FFFFFF', fontFamily: fonts.semibold },
  recentLabel: { ...sectionLabel, marginTop: spacing.sm },
  endText: { ...typography.caption, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.md },
})
