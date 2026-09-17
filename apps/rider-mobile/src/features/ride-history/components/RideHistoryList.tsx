import { useCallback } from 'react'
import { RefreshControl, StyleSheet, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { EmptyState, ErrorState, Skeleton, colors, spacing, typography } from '@ocar/mobile-shared'
import { useRideHistory } from '../hooks/useRideHistory'
import { RideHistoryRow } from './RideHistoryRow'

const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => i)

function RowSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton height={72} borderRadius={16} />
    </View>
  )
}

export function RideHistoryList() {
  const router = useRouter()
  const { items, upcoming, loading, refreshing, loadingMore, hasMore, error, refresh, loadMore } = useRideHistory()

  const openRide = useCallback((id: string) => router.push(`/ride/${id}`), [router])

  if (loading) {
    return (
      <FlashList
        data={SKELETON_ROWS}
        keyExtractor={(i) => String(i)}
        renderItem={RowSkeleton}
        contentContainerStyle={styles.content}
      />
    )
  }

  if (error && items.length === 0 && upcoming.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <ErrorState message={error} onRetry={refresh} />
      </View>
    )
  }

  if (items.length === 0 && upcoming.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <EmptyState title="No trips yet" description="Your ride history will show up here" />
      </View>
    )
  }

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <RideHistoryRow item={item} onPress={openRide} />}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      ListHeaderComponent={
        <View>
          {error ? (
            <View style={styles.retryBanner}>
              <Text style={styles.retryText} accessibilityLiveRegion="polite">{error}</Text>
              <Text style={styles.retryLink} onPress={refresh} accessibilityRole="button">Retry</Text>
            </View>
          ) : null}
          {upcoming.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {upcoming.map((item) => (
                <RideHistoryRow key={item.id} item={item} onPress={openRide} />
              ))}
              <Text style={styles.sectionTitle}>Past trips</Text>
            </View>
          ) : null}
        </View>
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.skeletonRow}><Skeleton height={72} borderRadius={16} /></View>
        ) : !hasMore && items.length > 0 ? (
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
  section: { paddingTop: spacing.xs },
  sectionTitle: { ...typography.label, color: colors.ink400, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  retryBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.errorLight,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  retryText: { ...typography.caption, color: colors.error, flex: 1 },
  retryLink: { ...typography.label, color: colors.error, fontWeight: '700' },
  endText: { ...typography.caption, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.md },
})
