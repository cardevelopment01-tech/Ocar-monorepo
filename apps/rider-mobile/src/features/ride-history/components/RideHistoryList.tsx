import { useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useNavClearance } from '@/features/home/FloatingTabBar'
import { geo } from '@/theme/homeTokens'
import { EmptyState, ErrorState, Skeleton, colors, radii, spacing, typography, type RideHistoryItem, fonts } from '@ocar/mobile-shared'
import { useRideHistory } from '../hooks/useRideHistory'
import { RideHistoryRow } from './RideHistoryRow'
import { UpcomingCard } from './UpcomingCard'
import { ActiveRideCard } from './ActiveRideCard'
import { filterRidesByTab } from '../filterRidesByTab'
import type { HistoryTab, UpcomingRide } from '../types'
import { confirmDialog } from '@/components/ui/confirm'
import { PickupTimeSheet } from '@/features/advance/PickupTimeSheet'
import { apiErrorCode, fetchCancelPreview } from '@/features/advance/api'
import { cancelCopy, rescheduleErrorMessage } from '@/features/advance/advanceModel'
import { getApiErrorMessage } from '@ocar/mobile-shared'

const TABS: { id: HistoryTab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
]

function RowSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton height={104} borderRadius={radii.lg} />
    </View>
  )
}

// Matches web's My Rides page (apps/user/app/(main)/history/page.tsx) 1:1: a
// sticky "My Rides" header with a total-count pill, four tab pills
// (Upcoming/All/Completed/Cancelled), an active-ride card + scheduled-ride
// list with per-ride cancel on the Upcoming tab, and a Prev/Next-paginated
// history list (not infinite scroll -- web isn't either) on the other three,
// each filtering the current page client-side same as web does.
export function RideHistoryList() {
  const router = useRouter()
  const clearance = useNavClearance()
  const {
    tab, setTab,
    rides, page, pages, total, loading, error, fetchHistory,
    upcoming, upcomingLoading, upcomingError, cancellingId, cancelUpcoming, rescheduleUpcoming, terms,
    activeRide,
    refresh,
  } = useRideHistory()

  const openRide = useCallback((id: string) => router.push(`/ride/${id}`), [router])

  // Change time: one sheet for the ride being edited. A failure keeps the sheet open and says why (the old time stays).
  const [editing, setEditing] = useState<UpcomingRide | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const saveTime = useCallback(async (iso: string) => {
    if (!editing) return
    setEditBusy(true); setEditError(null)
    try {
      await rescheduleUpcoming(editing.id, iso)
      setEditing(null)
    } catch (err) {
      setEditError(rescheduleErrorMessage(apiErrorCode(err), getApiErrorMessage(err, "We couldn't change the time. Your booking is unchanged.")))
    } finally {
      setEditBusy(false)
    }
  }, [editing, rescheduleUpcoming])

  // Cancel: ask the server what it would cost first, so a fee is never a surprise. If that check fails the rider can still cancel.
  const askCancel = useCallback(async (item: UpcomingRide) => {
    try {
      const copy = cancelCopy(await fetchCancelPreview(item.id))
      confirmDialog(copy.title, copy.body, [
        { text: 'Keep ride', style: 'cancel' },
        { text: copy.confirm, style: 'destructive', onPress: () => void cancelUpcoming(item.id) },
      ])
    } catch {
      confirmDialog('Cancel this ride?', "We couldn't check whether a fee applies. If one does, you will see it on your receipt.", [
        { text: 'Keep ride', style: 'cancel' },
        { text: 'Cancel ride', style: 'destructive', onPress: () => void cancelUpcoming(item.id) },
      ])
    }
  }, [cancelUpcoming])
  const bookRide = () => router.push('/(tabs)/home')

  const filtered = useMemo(() => filterRidesByTab(rides, tab), [rides, tab])

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>My Rides</Text>
        {tab !== 'upcoming' && !loading && total > 0 ? (
          <View style={styles.totalPill}>
            <Text style={styles.totalPillText}>{total} total</Text>
          </View>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tabPill, active ? styles.tabPillActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabPillText, active ? styles.tabPillTextActive : null]} maxFontSizeMultiplier={1.15} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )

  if (tab === 'upcoming') {
    return (
      <View style={styles.container}>
        {header}
        <FlatList<UpcomingRide>
          data={upcoming}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              {activeRide ? <ActiveRideCard ride={activeRide} onOpen={() => openRide(activeRide.id)} /> : null}
              {upcomingLoading ? (
                <View>
                  <RowSkeleton />
                  <RowSkeleton />
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <UpcomingCard
              ride={item}
              onOpen={() => openRide(item.id)}
              onCancel={() => void askCancel(item)}
              onChangeTime={() => { setEditError(null); setEditing(item) }}
              terms={terms}
              cancelling={cancellingId === item.id}
            />
          )}
          ListEmptyComponent={
            upcomingLoading ? null : upcomingError ? (
              <View style={styles.centerState}>
                <ErrorState message={upcomingError} onRetry={refresh} />
              </View>
            ) : (
              <View style={styles.centerState}>
                <EmptyState
                  title="No scheduled rides"
                  description="Schedule now and we'll find your driver closer to pickup. No need to book last-minute."
                />
                <Pressable onPress={bookRide} style={styles.ctaBtn}>
                  <Text style={styles.ctaText}>Book a ride</Text>
                </Pressable>
              </View>
            )
          }
        />
        <PickupTimeSheet
          visible={editing !== null}
          title="Change pickup time"
          confirmLabel="Change time"
          terms={terms}
          initial={editing?.scheduledFor ?? null}
          error={editError}
          busy={editBusy}
          onClose={() => { if (!editBusy) setEditing(null) }}
          onConfirm={(iso) => void saveTime(iso)}
        />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {header}
      <FlatList<RideHistoryItem>
        data={loading ? [] : filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />}
        renderItem={({ item }) => <RideHistoryRow item={item} onPress={openRide} />}
        ListHeaderComponent={loading ? <View><RowSkeleton /><RowSkeleton /><RowSkeleton /></View> : null}
        ListEmptyComponent={
          loading ? null : error ? (
            <View style={styles.centerState}>
              <ErrorState message={error} onRetry={() => void fetchHistory(1)} />
            </View>
          ) : (
            <View style={styles.centerState}>
              <EmptyState
                title={tab === 'all' ? 'No rides yet' : `No ${tab} rides`}
                description={tab === 'all' ? 'Your ride history will show up here once you take your first trip.' : `Rides that get ${tab} will show up here.`}
              />
              {tab === 'all' ? (
                <Pressable onPress={bookRide} style={styles.ctaBtn}>
                  <Text style={styles.ctaText}>Book a ride</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          !loading && !error && pages > 1 ? (
            <View style={styles.pager}>
              <Pressable
                disabled={page <= 1}
                onPress={() => void fetchHistory(page - 1)}
                style={[styles.pagerBtn, page <= 1 ? styles.pagerBtnDisabled : null]}
              >
                <Text style={styles.pagerBtnText}>Prev</Text>
              </Pressable>
              <Text style={styles.pagerLabel}>{page} / {pages}</Text>
              <Pressable
                disabled={page >= pages}
                onPress={() => void fetchHistory(page + 1)}
                style={[styles.pagerBtn, page >= pages ? styles.pagerBtnDisabled : null]}
              >
                <Text style={styles.pagerBtnText}>Next</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: geo.gutter, paddingTop: 20, paddingBottom: 12 },
  title: { ...typography.headline, color: colors.ink900, fontSize: 22 },
  totalPill: { backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.full },
  totalPillText: { ...typography.caption, fontSize: 11, color: colors.ink400, fontFamily: fonts.semibold },
  tabsRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: geo.gutter },
  tabPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.full, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  tabPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabPillText: { ...typography.caption, fontSize: 12, color: colors.ink400, fontFamily: fonts.semibold },
  tabPillTextActive: { color: colors.inkInverse },
  // paddingBottom clears the floating tab bar (see (tabs)/_layout.tsx)
  content: { paddingTop: spacing.md, flexGrow: 1 },
  skeletonRow: { paddingHorizontal: geo.gutter, paddingVertical: spacing.xs },
  centerState: { alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: geo.gutter, gap: spacing.sm },
  ctaBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 16, boxShadow: '0 10px 24px rgba(14,143,163,0.28)' },
  ctaText: { ...typography.label, color: colors.inkInverse, fontFamily: fonts.bold },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: geo.gutter, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  pagerBtn: { backgroundColor: colors.surface2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.full },
  pagerBtnDisabled: { opacity: 0.4 },
  pagerBtnText: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
  pagerLabel: { ...typography.caption, color: colors.ink400 },
})
