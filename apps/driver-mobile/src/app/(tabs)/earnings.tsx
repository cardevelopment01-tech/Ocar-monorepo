import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card, EmptyState, ErrorState, Skeleton, colors, formatCurrency, spacing, typography } from '@ocar/mobile-shared'
import { useTripHistory } from '@/features/earnings/useTripHistory'
import { TripRow } from '@/features/earnings/TripRow'

const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => i)

export default function EarningsScreen() {
  const { trips, summary, loading, refreshing, loadingMore, hasMore, error, refresh, loadMore } = useTripHistory()
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

  if (trips.length === 0) {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
        <EmptyState title="No trips yet" description="Go online to start accepting rides" />
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
      ListHeaderComponent={
        summary ? (
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Today</Text>
            <Text style={styles.summaryTotal}>{formatCurrency(summary.totalEarnings)}</Text>
            <Text style={styles.summaryDetail}>{summary.tripCount} trips</Text>
          </Card>
        ) : null
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.skeletonRow}>
            <Skeleton height={80} borderRadius={16} />
          </View>
        ) : !hasMore ? (
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
  summaryCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.xs },
  summaryLabel: { ...typography.label, color: colors.ink600 },
  summaryTotal: { ...typography.display, color: colors.ink900 },
  summaryDetail: { ...typography.body, color: colors.ink600 },
  endText: { ...typography.caption, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.md },
})
