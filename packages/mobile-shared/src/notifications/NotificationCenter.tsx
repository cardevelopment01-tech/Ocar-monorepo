import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AxiosInstance } from 'axios'
import type { Socket } from 'socket.io-client'
import { Skeleton } from '../ui/Skeleton'
import { Text } from '../ui/Text'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'
import {
  bumpUnreadCount,
  fetchNotificationPage,
  markAllNotificationsRead,
  markNotificationRead,
  notificationGroup,
  notificationIcon,
  notificationTone,
  refreshUnreadCount,
  setUnreadCount,
  type NotificationFeedItem,
} from './feed'
import { HeaderIconButton, NotificationHeader, ToneTile } from './notificationUi'
import type { PushPermissionState } from './pushPermission'

type Filter = 'all' | 'rides' | 'account'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'rides', label: 'Rides' },
  { key: 'account', label: 'Account' },
]

const EMPTY_COPY: Record<Filter, { title: string; body: string }> = {
  all: { title: 'You’re all caught up', body: 'Ride updates, payments and account alerts will show up here.' },
  rides: { title: 'No ride updates yet', body: 'Updates about your rides will show up here.' },
  account: { title: 'Nothing here yet', body: 'Payments, documents and account alerts will show up here.' },
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
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
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

  const unreadCount = useMemo(() => items.reduce((n, i) => (i.readAt ? n : n + 1), 0), [items])

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
  const subtitle = loading ? undefined : unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'

  return (
    <View style={styles.container}>
      <NotificationHeader
        title="Notifications"
        {...(subtitle ? { subtitle } : {})}
        onBack={onBack}
        right={<HeaderIconButton icon="settings" label="Notification settings" onPress={onOpenSettings} />}
      />

      {loading ? (
        <View style={styles.pad}>
          <View>
            {[0, 1, 2, 3].map((n) => (
              <View key={n} style={[styles.row, n === 0 ? styles.rowFirst : null, n === 3 ? styles.rowLast : null]}>
                {n > 0 ? <View style={styles.divider} /> : null}
                <Skeleton width={44} height={44} borderRadius={14} />
                <View style={styles.body}>
                  <Skeleton width="50%" height={14} />
                  <Skeleton width="92%" height={12} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : failed && items.length === 0 ? (
        <View style={styles.centered}>
          <View style={styles.emptyTile}><Feather name="wifi-off" size={26} color={colors.ink400} /></View>
          <Text style={styles.emptyTitle}>Couldn’t load notifications</Text>
          <Text style={styles.emptyBody}>Check your connection and try again.</Text>
          <Pressable onPress={() => { setLoading(true); void load() }} style={styles.pill} accessibilityRole="button">
            <Text style={styles.pillText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load() }} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={() => {
            // onEndReached can fire several times before `cursor` updates; without this guard the
            // same page was appended twice.
            if (!cursor || loadingMore.current) return
            loadingMore.current = true
            void load(cursor).finally(() => { loadingMore.current = false })
          }}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <View>
              {showBanner ? (
                <View style={styles.banner}>
                  <ToneTile icon="bell-off" tone="money" size={40} />
                  <View style={styles.body}>
                    <Text style={styles.bannerTitle}>Turn on notifications</Text>
                    <Text style={styles.bannerBody}>Don’t miss ride updates and alerts while the app is closed.</Text>
                  </View>
                  <Pressable onPress={onEnablePush} style={styles.pill} accessibilityRole="button">
                    <Text style={styles.pillText}>{permission.canAskAgain ? 'Turn on' : 'Settings'}</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.controls}>
                <View style={styles.chips}>
                  {FILTERS.map((f) => {
                    const active = filter === f.key
                    return (
                      <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, active ? styles.chipActive : null]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                        <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{f.label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
                <Pressable onPress={markAll} hitSlop={8} disabled={unreadCount === 0} style={[styles.markAll, unreadCount === 0 ? styles.disabled : null]} accessibilityRole="button">
                  <Feather name="check" size={14} color={colors.primary} />
                  <Text style={styles.markAllText}>Mark all read</Text>
                </Pressable>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <View style={styles.emptyTile}><Feather name="bell" size={26} color={colors.primary} /></View>
              <Text style={styles.emptyTitle}>{EMPTY_COPY[filter].title}</Text>
              <Text style={styles.emptyBody}>{EMPTY_COPY[filter].body}</Text>
              {filter !== 'all' ? (
                <Pressable onPress={() => setFilter('all')} style={styles.pill} accessibilityRole="button">
                  <Text style={styles.pillText}>Show all</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
          renderSectionFooter={() => <View style={styles.sectionGap} />}
          renderItem={({ item, index, section }) => <Row item={item} first={index === 0} last={index === section.data.length - 1} onPress={open} />}
        />
      )}
    </View>
  )
}

function Row({ item, first, last, onPress }: { item: NotificationFeedItem; first: boolean; last: boolean; onPress: (i: NotificationFeedItem) => void }) {
  const unread = !item.readAt
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, first ? styles.rowFirst : null, last ? styles.rowLast : null, unread ? styles.rowUnread : null, pressed ? styles.rowPressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title ?? ''}. ${item.body}`}
    >
      {!first ? <View style={styles.divider} /> : null}
      {unread ? <View style={styles.dot} /> : null}
      <ToneTile icon={notificationIcon(item.type)} tone={notificationTone(item.type)} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.rowTitle, unread ? styles.rowTitleUnread : null]} numberOfLines={1}>{item.title ?? item.body}</Text>
          <Text style={styles.rowTime}>{timeLabel(item.createdAt)}</Text>
        </View>
        {item.title ? <Text style={styles.rowText} numberOfLines={3}>{item.body}</Text> : null}
      </View>
    </Pressable>
  )
}

const TILE = 44
const ROW_PAD = spacing.md
// Hairline starts under the text, not under the tile, the way grouped lists do on both platforms.
const DIVIDER_INSET = ROW_PAD + TILE + spacing.sm + 4

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: spacing.lg },
  body: { flex: 1, gap: 3 },

  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, padding: spacing.md, marginBottom: spacing.md, borderRadius: radii['2xl'], backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bannerTitle: { ...typography.label, fontSize: 14, color: colors.ink900, fontFamily: fonts.semibold },
  bannerBody: { ...typography.caption, color: colors.ink600 },
  pill: { paddingHorizontal: spacing.md, height: 34, borderRadius: radii.full, backgroundColor: colors.ink900, alignItems: 'center', justifyContent: 'center' },
  pillText: { ...typography.label, color: colors.inkInverse, fontFamily: fonts.bold },

  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingBottom: spacing.xs },
  chips: { flexDirection: 'row', gap: spacing.sm, flexShrink: 1 },
  chip: { height: 34, paddingHorizontal: spacing.md - 2, borderRadius: radii.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  chipTextActive: { color: colors.inkInverse },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34 },
  markAllText: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
  disabled: { opacity: 0.35 },

  // Sentence-case, not tracked caps: DESIGN.md's No Eyebrow Rule.
  sectionTitle: { ...typography.label, fontSize: 14, color: colors.ink600, fontFamily: fonts.semibold, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionGap: { height: spacing.xs },

  // One grouped card per day: rows are slices of it, so there are no cards inside cards.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 4, paddingHorizontal: ROW_PAD, paddingVertical: ROW_PAD - 2, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.borderLight },
  rowFirst: { borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], borderTopWidth: 1 },
  rowLast: { borderBottomLeftRadius: radii['2xl'], borderBottomRightRadius: radii['2xl'], borderBottomWidth: 1 },
  rowUnread: { backgroundColor: 'rgba(14,143,163,0.035)' },
  rowPressed: { backgroundColor: colors.surface3 },
  divider: { position: 'absolute', top: 0, left: DIVIDER_INSET, right: ROW_PAD, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  // Sits in the row's left gutter, level with the middle of the tile.
  dot: { position: 'absolute', left: 4, top: ROW_PAD - 2 + TILE / 2 - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rowTitle: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.ink900, fontFamily: fonts.medium },
  rowTitleUnread: { fontFamily: fonts.bold },
  rowText: { fontSize: 14, lineHeight: 20, color: colors.ink600, fontFamily: fonts.regular },
  rowTime: { ...typography.caption, color: colors.ink400 },

  centered: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing['2xl'] },
  emptyTile: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  emptyTitle: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, textAlign: 'center' },
  emptyBody: { ...typography.label, color: colors.ink600, textAlign: 'center', lineHeight: 20, marginBottom: spacing.sm },
})
