import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather, Ionicons } from '@expo/vector-icons'
import { colors, radii, spacing, typography, useRoomJoin } from '@ocar/mobile-shared'
import { socket } from '@/services/socket'
import { fetchChatMessages, fetchRide, markChatRead, sendChatMessage, type ChatMessage } from '@/features/ride-tracking/api'

const CANNED_REPLIES = [
  'Are you coming?',
  'Where are you?',
  'I am at my pick up point.',
  'I am in urgent please come soon',
]

const CLOSED_STATUSES = new Set(['completed', 'cancelled', 'no_drivers'])

// Local send-lifecycle overlay on top of the server message shape --
// 'sending'/'failed' are client-only, the server never reports them.
type LocalStatus = 'sending' | 'sent' | 'failed'
type LocalMessage = ChatMessage & { localStatus?: LocalStatus }

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

// Not crypto.randomUUID() -- Hermes doesn't implement the Web Crypto API and
// no polyfill (react-native-get-random-values, expo-crypto) is installed in
// this project, so that call threw synchronously the moment send() ran,
// silently killing every send attempt with nothing visible on screen -- no
// red-box in a release build, just a swallowed rejected promise.
//
// The backend validates this against a strict UUID shape (ride-chat.controller.ts's
// UUID_RE) and 400s otherwise, so an arbitrary unique string isn't enough --
// this has to actually look like a v4 UUID. Math.random() isn't
// cryptographically secure, but that's fine here: this is a client-side
// dedup/retry key, never a security token.
function generateClientMsgId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

type DriverInfo = { name: string | null; photo: string | null; rating: string | null }

export default function RideChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()

  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [driver, setDriver] = useState<DriverInfo>({ name: null, photo: null, rating: null })
  const [rideStatus, setRideStatus] = useState<string | null>(null)
  const listRef = useRef<FlatList<LocalMessage>>(null)
  const lastSeenIdRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)
  const isClosed = rideStatus !== null && CLOSED_STATUSES.has(rideStatus)

  useRoomJoin(socket, rideId)

  // Merge a freshly-arrived server message into state: replace the optimistic
  // local echo (matched by clientMsgId) if present, otherwise append.
  const upsertMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.clientMsgId === msg.clientMsgId)
      if (idx === -1) return [...prev, { ...msg, localStatus: 'sent' }]
      const next = [...prev]
      next[idx] = { ...msg, localStatus: 'sent' }
      return next
    })
    lastSeenIdRef.current = msg.id
  }, [])

  useEffect(() => {
    if (!rideId) return
    mountedRef.current = true
    // Tells the server this screen is watching this ride's chat live, so a
    // new message doesn't also trigger a redundant push/in-app notification.
    socket.emit('chat:open', { rideId })

    let mounted = true
    fetchChatMessages(rideId)
      .then((history) => {
        if (!mounted) return
        setMessages(history.map((m) => ({ ...m, localStatus: 'sent' })))
        if (history.length) lastSeenIdRef.current = history[history.length - 1]!.id
        void markChatRead(rideId).catch(() => {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    fetchRide(rideId)
      .then((ride) => {
        if (!mounted) return
        setDriver({ name: ride.driverName, photo: ride.driverPhoto, rating: ride.driverRating })
        setRideStatus(ride.status)
      })
      .catch(() => {})

    function onChatMessage(msg: ChatMessage) {
      if (String(msg.rideId) !== String(rideId)) return
      upsertMessage(msg)
      if (msg.senderType === 'driver') void markChatRead(rideId).catch(() => {})
    }

    function onChatRead({ rideId: msgRideId, readerType }: { rideId: string; readerType: 'user' | 'driver' }) {
      if (String(msgRideId) !== String(rideId)) return
      if (readerType !== 'driver') return
      setMessages((prev) => prev.map((m) => (m.senderType === 'user' ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m)))
    }

    function onReconnect() {
      fetchChatMessages(rideId, lastSeenIdRef.current)
        .then((caughtUp) => {
          if (!mounted || !caughtUp.length) return
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.clientMsgId))
            const fresh = caughtUp.filter((m) => !known.has(m.clientMsgId)).map((m) => ({ ...m, localStatus: 'sent' as const }))
            return fresh.length ? [...prev, ...fresh] : prev
          })
          lastSeenIdRef.current = caughtUp[caughtUp.length - 1]!.id
          if (caughtUp.some((m) => m.senderType === 'driver')) void markChatRead(rideId).catch(() => {})
        })
        .catch(() => {})
    }

    socket.on('chat:message', onChatMessage)
    socket.on('chat:read', onChatRead)
    socket.on('connect', onReconnect)

    return () => {
      mounted = false
      mountedRef.current = false
      socket.emit('chat:close', { rideId })
      socket.off('chat:message', onChatMessage)
      socket.off('chat:read', onChatRead)
      socket.off('connect', onReconnect)
    }
  }, [rideId, upsertMessage])

  async function send(body: string) {
    const trimmed = body.trim()
    if (!trimmed || !rideId) return
    const clientMsgId = generateClientMsgId()
    const optimistic: LocalMessage = {
      id: clientMsgId,
      rideId,
      senderType: 'user',
      senderId: '',
      body: trimmed,
      clientMsgId,
      readAt: null,
      createdAt: new Date().toISOString(),
      localStatus: 'sending',
    }
    setMessages((prev) => [...prev, optimistic])
    setDraft('')

    try {
      const sent = await sendChatMessage(rideId, trimmed, clientMsgId)
      if (!mountedRef.current) return
      upsertMessage(sent)
    } catch {
      if (!mountedRef.current) return
      setMessages((prev) => prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, localStatus: 'failed' } : m)))
    }
  }

  async function retry(msg: LocalMessage) {
    setMessages((prev) => prev.map((m) => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: 'sending' } : m)))
    try {
      const sent = await sendChatMessage(rideId, msg.body, msg.clientMsgId)
      if (!mountedRef.current) return
      upsertMessage(sent)
    } catch {
      if (!mountedRef.current) return
      setMessages((prev) => prev.map((m) => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: 'failed' } : m)))
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Feather name="chevron-left" size={20} color={colors.ink900} />
        </Pressable>
        {driver.photo ? (
          <Image source={{ uri: driver.photo }} style={styles.headerPhoto} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.headerPhoto, styles.headerPhotoFallback]}>
            <Text style={styles.headerPhotoInitial}>{(driver.name ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{driver.name ?? 'Your driver'}</Text>
          {driver.rating ? (
            <View style={styles.headerRatingRow}>
              <Text style={styles.headerRatingStar}>★</Text>
              <Text style={styles.headerRatingValue}>{Number(driver.rating).toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No messages yet. Send a quick update below.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.clientMsgId}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <Bubble msg={item} onRetry={() => retry(item)} />}
        />
      )}

      {isClosed ? (
        <View style={styles.readOnlyBanner}>
          <Text style={styles.readOnlyText}>This ride has ended · Chat is read-only</Text>
        </View>
      ) : (
        <>
          <FlatList
            horizontal
            data={CANNED_REPLIES}
            keyExtractor={(r) => r}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cannedRow}
            renderItem={({ item }) => (
              <Pressable onPress={() => void send(item)} style={styles.cannedChip}>
                <Text style={styles.cannedChipText}>{item}</Text>
              </Pressable>
            )}
          />
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message"
              placeholderTextColor={colors.ink400}
              selectionColor={colors.primary}
              cursorColor={colors.primary}
              style={styles.inputWrap}
              multiline
              maxLength={1000}
            />
            <Pressable
              onPress={() => void send(draft)}
              disabled={!draft.trim()}
              style={({ pressed }) => [styles.sendBtn, !draft.trim() ? styles.sendBtnDisabled : null, pressed && draft.trim() ? styles.pressedScale : null]}
            >
              <Feather name="send" size={16} color={colors.inkInverse} />
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  )
}

function Bubble({ msg, onRetry }: { msg: LocalMessage; onRetry: () => void }) {
  const mine = msg.senderType === 'user'
  const failed = msg.localStatus === 'failed'

  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, mine && msg.localStatus === 'sending' ? styles.bubbleSending : null]}>
        <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : null]}>{msg.body}</Text>
      </View>
      <View style={[styles.metaRow, mine ? styles.metaRowMine : null]}>
        <Text style={styles.metaTime}>{fmtTime(msg.createdAt)}</Text>
        {mine && !failed ? (
          msg.localStatus === 'sending' ? (
            <Text style={styles.metaSending}>Sending…</Text>
          ) : msg.readAt ? (
            <Ionicons name="checkmark-done" size={13} color={colors.accent} />
          ) : (
            <Ionicons name="checkmark" size={13} color={colors.primary} />
          )
        ) : null}
        {mine && failed ? (
          <Pressable onPress={onRetry}>
            <Text style={styles.metaFailed}>Failed · Tap to retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  backBtn: { width: 36, height: 36, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerPhoto: { width: 36, height: 36, borderRadius: radii.md },
  headerPhotoFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  headerPhotoInitial: { ...typography.label, color: colors.primary, fontWeight: '700' },
  headerInfo: { flex: 1, minWidth: 0, gap: 1 },
  headerName: { ...typography.label, fontSize: 15, fontWeight: '700', color: colors.ink900 },
  headerRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  headerRatingStar: { fontSize: 11, color: colors.warning },
  headerRatingValue: { ...typography.caption, fontWeight: '600', color: colors.ink600 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyText: { ...typography.body, color: colors.ink400, textAlign: 'center', fontWeight: '600' },
  list: { padding: spacing.md, gap: spacing.xs },
  bubbleRow: { alignItems: 'flex-start' },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: radii.lg, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, marginBottom: 2 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  bubbleMine: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  bubbleSending: { opacity: 0.7 },
  bubbleText: { ...typography.body, color: colors.ink900 },
  bubbleTextMine: { color: colors.inkInverse },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2, marginBottom: spacing.xs },
  metaRowMine: { alignSelf: 'flex-end' },
  metaTime: { fontSize: 10.5, fontWeight: '600', color: colors.ink400 },
  metaSending: { fontSize: 10.5, color: colors.ink400 },
  metaFailed: { fontSize: 10.5, fontWeight: '700', color: colors.error },
  readOnlyBanner: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm + 4, paddingBottom: spacing.md },
  readOnlyText: { ...typography.caption, fontWeight: '600', color: colors.primaryDark, backgroundColor: colors.primarySubtle, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radii.full, overflow: 'hidden' },
  cannedRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, gap: spacing.xs },
  cannedChip: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 4, borderRadius: radii.full, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  cannedChipText: { ...typography.caption, fontWeight: '600', color: colors.ink600 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  inputWrap: { flex: 1, ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
