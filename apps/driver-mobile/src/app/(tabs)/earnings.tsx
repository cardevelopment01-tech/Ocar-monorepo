import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card, EmptyState, ErrorState, Skeleton, colors, spacing, typography } from '@ocar/mobile-shared'
import { useTripHistory } from '@/features/earnings/useTripHistory'
import { TripRow } from '@/features/earnings/TripRow'
import { PeriodTabs } from '@/features/earnings/components/PeriodTabs'
import { EarningsBarChart } from '@/features/earnings/components/EarningsBarChart'
import { EarningsBreakdown } from '@/features/earnings/components/EarningsBreakdown'

const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => i)
const PERIOD_LABEL = { today: 'Today', week: 'This Week', month: 'This Month' } as const

export default function EarningsScreen() {
  const { trips, summary, period, setPeriod, loading, refreshing, loadingMore, summaryLoading, hasMore, error, refresh, loadMore } = useTripHistory()
  const insets = useSafeAreaInsets()

  if (loading) {
    return (
      <FlashList
        data={SKELETON_ROWS}
        keyExtractor={(i) => String(i)}
        renderItem={() => (
          <View style={styles.skeletonRow}>
            <Skeleton height={80} borderRadius={16} />
          </View>
        )}
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
      />
    )
  }

  if (error && trips.length === 0) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        <ErrorState message={error} onRetry={refresh} />
      </View>
    )
  }

  return (
    <FlashList
      data={trips}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <TripRow item={item} />}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
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

          <Card style={[styles.summaryCard, summaryLoading ? styles.summaryLoading : null]}>
            <Text style={styles.summaryLabel}>{PERIOD_LABEL[period]}</Text>
            <Text style={styles.summaryTotal}>₹{(summary?.totalEarnings ?? 0).toLocaleString('en-IN')}</Text>
            <View style={styles.pillRow}>
              <View style={styles.pill}><Text style={styles.pillText}>{summary?.tripCount ?? 0} trips</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>{summary?.onlineHours ?? '0m'} online</Text></View>
              <View style={styles.pill}><Text style={styles.pillText}>★ {summary?.rating ?? '—'}</Text></View>
            </View>
          </Card>

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
  content: { paddingVertical: spacing.md },
  centerContainer: { flex: 1, justifyContent: 'center' },
  skeletonRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  header: { paddingHorizontal: spacing.lg, gap: spacing.md, marginBottom: spacing.sm },
  emptyWrap: { paddingHorizontal: spacing.lg },
  summaryCard: { gap: spacing.xs },
  summaryLoading: { opacity: 0.6 },
  summaryLabel: { ...typography.label, color: colors.ink600 },
  summaryTotal: { ...typography.display, color: colors.ink900 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  pill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  pillText: { ...typography.caption, color: colors.ink600, fontWeight: '600' },
  recentLabel: { ...typography.body, color: colors.ink900, fontWeight: '700' },
  endText: { ...typography.caption, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.md },
})
