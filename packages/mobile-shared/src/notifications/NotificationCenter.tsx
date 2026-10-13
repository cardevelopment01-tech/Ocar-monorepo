import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AxiosInstance } from 'axios'
import type { Socket } from 'socket.io-client'
import { Skeleton } from '../ui/Skeleton'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import {
  bumpUnreadCount,
  fetchNotificationPage,
  isUrgentNotification,
  markAllNotificationsRead,
  markNotificationRead,
  notificationGroup,
  refreshUnreadCount,
  setUnreadCount,
  type NotificationFeedItem,
  type NotificationGroup,
} from './feed'
import type { PushPermissionState } from './pushPermission'

type Filter = 'all' | 'rides' | 'account'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'rides', label: 'Rides' },
  { key: 'account', label: 'Account & payments' },
]

const GROUP_ICON: Record<NotificationGroup, React.ComponentProps<typeof Feather>['name']> = {
  rides: 'navigation',
  payments: 'credit-card',
  account: 'user',
  other: 'bell',
}

export type NotificationCenterProps = {
  api: AxiosInstance
  socket: Socket
  /** The app's own type -> screen mapping (the same one push taps use). null = nothing to open. */
  resolveRoute: (data: Record<string, string>) => string | null
  onNavigate: (route: string) => void
  onBack: () => void
  onOpenSettings: () => void
  permission: { state: PushPermissionState | null; canAskAgain: boolean }
  /** Asks for permission (system dialog), or opens system settings when the dialog is no longer possible. */
  onEnablePush: () => void
}

type Section = { title: string; data: NotificationFeedItem[] }

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function timeLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'Just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export function NotificationCenter({ api, socket, resolveRoute, onNavigate, onBack, onOpenSettings, permission, onEnablePush }: NotificationCenterProps) {
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<NotificationFeedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const loadingMore = useRef(false)

  const load = useCallback(async (after?: string) => {
    try {
      const data = await fetchNotificationPage(api, after)
      setItems((prev) => {
        if (!after) return data.items
        const seen = new Set(prev.map((i) => i.id))
        return [...prev, ...data.items.filter((i) => !seen.has(i.id))]
      })
      setCursor(data.nextCursor)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  // New notifications appear at the top without a refetch.
  useEffect(() => {
    const onNew = (item: NotificationFeedItem) => {
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [item, ...prev]))
    }
    socket.on('notification:new', onNew)
    return () => { socket.off('notification:new', onNew) }
  }, [socket])

  // Whatever happened in here, leave the badge in step with the server.
  useEffect(() => () => { void refreshUnreadCount(api) }, [api])

  const unreadInList = useMemo(() => items.some((i) => !i.readAt), [items])

  const sections = useMemo<Section[]>(() => {
    const visible = items.filter((i) => {
      if (filter === 'all') return true
      const g = notificationGroup(i.type)
      return filter === 'rides' ? g === 'rides' : g !== 'rides'
    })
    const out: Section[] = []
    for (const item of visible) {
      const title = dayLabel(item.createdAt)
      const last = out[out.length - 1]
      if (last && last.title === title) last.data.push(item)
      else out.push({ title, data: [item] })
    }
    return out
  }, [items, filter])

  function open(item: NotificationFeedItem) {
    if (!item.readAt) {
      const now = new Date().toISOString()
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: now } : i)))
      bumpUnreadCount(-1)
      markNotificationRead(api, item.id).catch(() => { void refreshUnreadCount(api) })
    }
    const route = resolveRoute({ type: item.type, ...(item.rideId ? { rideId: item.rideId } : {}) })
    if (route) onNavigate(route)
  }

  function markAll() {
    const now = new Date().toISOString()
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? now })))
    setUnreadCount(0)
    markAllNotificationsRead(api).catch(() => { void refreshUnreadCount(api) })
  }

  const showBanner = permission.state !== null && permission.state !== 'granted'

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Feather name="arrow-left" size={18} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <Pressable onPress={onOpenSettings} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Notification settings">
          <Feather name="settings" size={17} color={colors.ink900} />
        </Pressable>
      </View>

      {showBanner ? (
        <View style={styles.banner}>
          <Feather name="bell-off" size={18} color={colors.warning} />
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>Notifications are off</Text>
            <Text style={styles.bannerBody}>You won&apos;t hear about ride updates or important alerts while the app is closed.</Text>
          </View>
          <Pressable onPress={onEnablePush} style={styles.bannerBtn} accessibilityRole="button">
            <Text style={styles.bannerBtnText}>{permission.canAskAgain ? 'Turn on' : 'Settings'}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.filterRow}>
        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key ? styles.chipActive : null]} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}>
              <Text style={[styles.chipText, filter === f.key ? styles.chipTextActive : null]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={markAll} hitSlop={8} disabled={!unreadInList}>
          <Text style={[styles.markAll, !unreadInList ? styles.disabled : null]}>Mark all read</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((n) => (
            <View key={n} style={styles.row}>
              <Skeleton width={40} height={40} borderRadius={20} />
              <View style={styles.rowBody}>
                <Skeleton width="55%" height={14} />
                <Skeleton width="90%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : failed && items.length === 0 ? (
        <Pressable onPress={() => { setLoading(true); void load() }} accessibilityRole="button">
          <Text style={styles.empty}>Couldn&apos;t load notifications. Tap to retry.</Text>
        </Pressable>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load() }} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={() => {
            // onEndReached can fire several times before `cursor` updates; without this guard the
            // same page was appended twice.
            if (!cursor || loadingMore.current) return
            loadingMore.current = true
            void load(cursor).finally(() => { loadingMore.current = false })
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Text style={styles.empty}>{filter === 'all' ? "You're all caught up." : 'Nothing here yet.'}</Text>
          }
          renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
          renderItem={({ item }) => <Row item={item} onPress={open} />}
        />
      )}
    </View>
  )
}

function Row({ item, onPress }: { item: NotificationFeedItem; onPress: (i: NotificationFeedItem) => void }) {
  const urgent = isUrgentNotification(item.type)
  const unread = !item.readAt
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={[styles.row, unread ? styles.rowUnread : null]}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title ?? ''}. ${item.body}`}
    >
      <View style={[styles.icon, urgent ? styles.iconUrgent : null]}>
        <Feather name={urgent ? 'alert-circle' : GROUP_ICON[notificationGroup(item.type)]} size={18} color={urgent ? colors.error : colors.primary} />
      </View>
      <View style={styles.rowBody}>
        {item.title ? <Text style={[styles.rowTitle, unread ? styles.rowTitleUnread : null]} numberOfLines={1}>{item.title}</Text> : null}
        <Text style={styles.rowText} numberOfLines={3}>{item.body}</Text>
        <Text style={styles.rowTime}>{timeLabel(item.createdAt)}</Text>
      </View>
      {unread ? <View style={styles.dot} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.warningLight },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { ...typography.body, lineHeight: 20, color: colors.ink900, fontFamily: fonts.semibold },
  bannerBody: { ...typography.caption, color: colors.ink600 },
  bannerBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radii.full, backgroundColor: colors.ink900 },
  bannerBtnText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.bold },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.xs, flexShrink: 1, flexWrap: 'wrap' },
  chip: { paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radii.full, backgroundColor: colors.surface2 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  chipTextActive: { color: colors.inkInverse },
  markAll: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold },
  disabled: { opacity: 0.35 },
  sectionTitle: { ...typography.caption, color: colors.ink400, fontFamily: fonts.semibold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.md, marginBottom: spacing.xs },
  skeletons: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  rowUnread: { backgroundColor: colors.primarySubtle },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  iconUrgent: { backgroundColor: colors.errorLight },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, lineHeight: 20, color: colors.ink900, fontFamily: fonts.semibold },
  rowTitleUnread: { fontFamily: fonts.bold },
  rowText: { ...typography.body, lineHeight: 20, color: colors.ink600 },
  rowTime: { ...typography.caption, color: colors.ink400, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  empty: { ...typography.body, color: colors.ink400, textAlign: 'center', marginTop: spacing.xl },
})
