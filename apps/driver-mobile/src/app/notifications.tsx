import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Text } from '@ocar/mobile-shared'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { resolvePushRoute } from '@/features/notifications/pushRouting'

type FeedItem = {
  id: string
  type: string
  title: string | null
  body: string
  rideId: string | null
  readAt: string | null
  createdAt: string
}

export default function NotificationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<FeedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (after?: string) => {
    try {
      const res = await api.get('/api/v1/notifications', { params: after ? { cursor: after } : {} })
      const data = res.data as { items: FeedItem[]; nextCursor: string | null }
      setItems((prev) => (after ? [...prev, ...data.items] : data.items))
      setCursor(data.nextCursor)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function open(item: FeedItem) {
    if (!item.readAt) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)))
      api.patch(`/api/v1/notifications/${item.id}/read`).catch(() => {})
    }
    const route = resolvePushRoute({ type: item.type, ...(item.rideId ? { rideId: item.rideId } : {}) })
    if (route) router.push(route as never)
  }

  function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })))
    api.post('/api/v1/notifications/read-all').catch(() => {})
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Back">
          <Feather name="arrow-left" size={18} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <Pressable onPress={markAll} hitSlop={8} disabled={!items.some((i) => !i.readAt)}>
          <Text style={[styles.markAll, !items.some((i) => !i.readAt) ? { opacity: 0.35 } : null]}>Mark all read</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      ) : failed && items.length === 0 ? (
        <Pressable onPress={() => { setLoading(true); void load() }}>
          <Text style={styles.empty}>Couldn't load notifications. Tap to retry.</Text>
        </Pressable>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, gap: spacing.sm }}
          onEndReached={() => { if (cursor) void load(cursor) }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Text style={styles.empty}>You're all caught up.</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => open(item)} style={[styles.row, !item.readAt ? styles.rowUnread : null]}>
              <View style={{ flex: 1 }}>
                {item.title ? <Text style={styles.rowTitle}>{item.title}</Text> : null}
                <Text style={styles.rowBody}>{item.body}</Text>
                <Text style={styles.rowTime}>{new Date(item.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
              </View>
              {!item.readAt ? <View style={styles.dot} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
  markAll: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  rowUnread: { backgroundColor: colors.primarySubtle },
  rowTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  rowBody: { ...typography.body, color: colors.ink600 },
  rowTime: { ...typography.caption, color: colors.ink400, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  empty: { ...typography.body, color: colors.ink400, textAlign: 'center', marginTop: spacing.xl },
})
