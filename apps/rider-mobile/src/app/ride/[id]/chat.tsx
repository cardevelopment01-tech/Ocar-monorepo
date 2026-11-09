import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn, FadeInUp, useAnimatedStyle } from 'react-native-reanimated'
import { Feather, Ionicons } from '@expo/vector-icons'
import { spacing, useKeyboardOffset, useRoomJoin, font, h } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { ChatBackdrop } from '@/features/ride-tracking/components/ChatBackdrop'
import { socket } from '@/services/socket'
import { DriverRow, driverViewFromRide } from '@/features/ride-tracking/components/DriverIdentity'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
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
// `fresh` = arrived or was sent after the screen opened; only those get the entrance animation
// (history that loads on open used to spring-animate every visible bubble at once).
type LocalMessage = ChatMessage & { localStatus?: LocalStatus; fresh?: boolean }

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

export default function RideChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()

  const insets = useSafeAreaInsets()
  const keyboardOffset = useKeyboardOffset()
  // Pad (not translate) by the keyboard height: the message list shrinks and the
  // header/back button stay on screen. The input row's safe-area padding fades
  // out as the keyboard covers that strip, so there's no gap above the keyboard.
  const restingBottomPad = Math.max(insets.bottom, spacing.md)
  const keyboardStyle = useAnimatedStyle(() => ({ paddingBottom: keyboardOffset.get() }))
  const inputRowPadStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(restingBottomPad - keyboardOffset.get(), spacing.md),
  }))

  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [driverRide, setDriverRide] = useState<RideDetailExtra | null>(null)
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
      if (idx === -1) return [...prev, { ...msg, localStatus: 'sent', fresh: true }]
      const next = [...prev]
      next[idx] = { ...msg, localStatus: 'sent', fresh: true }
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
        setDriverRide(ride)
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
            const fresh = caughtUp.filter((m) => !known.has(m.clientMsgId)).map((m) => ({ ...m, localStatus: 'sent' as const, fresh: true }))
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
      fresh: true,
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

  const retry = useCallback(async (msg: LocalMessage) => {
    setMessages((prev) => prev.map((m) => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: 'sending' } : m)))
    try {
      const sent = await sendChatMessage(rideId, msg.body, msg.clientMsgId)
      if (!mountedRef.current) return
      upsertMessage(sent)
    } catch {
      if (!mountedRef.current) return
      setMessages((prev) => prev.map((m) => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: 'failed' } : m)))
    }
  }, [rideId, upsertMessage])

  // Stable renderItem + memoised Bubble: typing in the input no longer re-renders every visible bubble.
  const renderItem = useCallback(({ item }: { item: LocalMessage }) => <Bubble msg={item} onRetry={retry} />, [retry])

  return (
    // Not KeyboardAvoidingView -- `behavior="padding"` only actually does
    // anything on iOS (Android's branch passes `undefined`, a no-op), and
    // under edgeToEdgeEnabled, adjustResize doesn't reliably shrink content
    // to compensate either. useKeyboardOffset is the proven-reliable fix used
    // across the rest of this ride flow (AddStopSheet/CancelSheet) and driver
    // app's own chat screen.
    <Animated.View style={[styles.container, keyboardStyle]}>
      <ChatBackdrop />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <IconButton icon="arrow-left" label="Back" onPress={() => goBack(router, { pathname: '/ride/[id]', params: { id: rideId } })} />
        <DriverRow view={driverViewFromRide(driverRide)} photo={driverRide?.driverPhoto ?? null} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={h.teal} />
        </View>
      ) : messages.length === 0 ? (
        <Animated.View entering={FadeInUp.duration(280)} style={styles.centered}>
          <View style={styles.emptyIconWrap}>
            <Feather name="message-circle" size={22} color={h.tealText} />
          </View>
          <Text style={styles.emptyText}>No messages yet. Send a quick update below.</Text>
        </Animated.View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.messageList}
          data={messages}
          keyExtractor={(m) => m.clientMsgId}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          // List shrinks when the keyboard opens -- keep the latest message visible
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={<Text style={styles.privacy}>Your number stays private. Messages are only for this ride.</Text>}
          renderItem={renderItem}
        />
      )}

      {isClosed ? (
        <Animated.View entering={FadeInUp.duration(280)} style={styles.readOnlyBanner}>
          <Text style={styles.readOnlyText}>This ride has ended · Chat is read-only</Text>
        </Animated.View>
      ) : (
        <>
          {/* Plain ScrollView, not FlatList -- CANNED_REPLIES is a small fixed
              array (no virtualization benefit), and a horizontal FlatList with
              no explicit `style` height here was stretching each chip's cross-axis
              to fill the remaining screen height, rendering as a giant vertical
              capsule instead of a compact pill (radii.full on a tall-narrow box). */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cannedRow}
            style={styles.cannedScroll}
          >
            {CANNED_REPLIES.map((reply) => (
              <Pressable
                key={reply}
                onPress={() => void send(reply)}
                style={({ pressed }) => [styles.cannedChip, pressed ? styles.pressedScale : null]}
              >
                <Text style={styles.cannedChipText}>{reply}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Animated.View style={[styles.inputRow, inputRowPadStyle]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message"
              placeholderTextColor={h.faint}
              selectionColor={h.teal}
              cursorColor={h.teal}
              style={styles.inputWrap}
              multiline
              maxLength={1000}
            />
            <Pressable
              onPress={() => void send(draft)}
              disabled={!draft.trim()}
              style={({ pressed }) => [styles.sendBtn, !draft.trim() ? styles.sendBtnDisabled : null, pressed && draft.trim() ? styles.pressedScale : null]}
            >
              <Feather name="send" size={19} color="#FFFFFF" />
            </Pressable>
          </Animated.View>
        </>
      )}
    </Animated.View>
  )
}

const Bubble = memo(function Bubble({ msg, onRetry }: { msg: LocalMessage; onRetry: (msg: LocalMessage) => void }) {
  const mine = msg.senderType === 'user'
  const failed = msg.localStatus === 'failed'

  return (
    <Animated.View
      {...(msg.fresh ? { entering: FadeIn.duration(160) } : {})}
      style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}
    >
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          mine && msg.localStatus === 'sending' ? styles.bubbleSending : null,
        ]}
      >
        <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : null]}>{msg.body}</Text>
      </View>
      <View style={[styles.metaRow, mine ? styles.metaRowMine : null]}>
        <Text style={styles.metaTime}>{fmtTime(msg.createdAt)}</Text>
        {mine && !failed ? (
          msg.localStatus === 'sending' ? (
            <Text style={styles.metaSending}>Sending…</Text>
          ) : msg.readAt ? (
            <Ionicons name="checkmark-done" size={14} color={h.gold} />
          ) : (
            <Ionicons name="checkmark" size={14} color={h.tealText} />
          )
        ) : null}
        {mine && failed ? (
          <Pressable onPress={() => onRetry(msg)}>
            <Text style={styles.metaFailed}>Failed · Tap to retry</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: 12 },
  emptyIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: font.sb, fontSize: 14.5, color: h.muted, textAlign: 'center' },
  messageList: { flex: 1 },
  list: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, gap: 4 },
  privacy: { alignSelf: 'center', maxWidth: 300, textAlign: 'center', fontFamily: font.m, fontSize: 12.5, lineHeight: 19, color: h.label, marginBottom: 16 },
  bubbleRow: { alignItems: 'flex-start' },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: 15, paddingVertical: 11, marginBottom: 2 },
  bubbleTheirs: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, alignSelf: 'flex-start', borderRadius: 20, borderBottomLeftRadius: 6, boxShadow: '0 2px 8px rgba(20,23,26,0.05)' },
  bubbleMine: { backgroundColor: h.tealCta, alignSelf: 'flex-end', borderRadius: 20, borderBottomRightRadius: 6, boxShadow: '0 6px 14px rgba(14,143,163,0.20)' },
  bubbleSending: { opacity: 0.7 },
  bubbleText: { fontFamily: font.m, fontSize: 14.5, lineHeight: 21, color: h.ivory },
  bubbleTextMine: { color: '#FFFFFF' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, marginBottom: 8 },
  metaRowMine: { alignSelf: 'flex-end' },
  metaTime: { fontSize: 11, fontFamily: font.m, color: h.faint, fontVariant: ['tabular-nums'] },
  metaSending: { fontSize: 11, fontFamily: font.m, color: h.faint },
  metaFailed: { fontSize: 11.5, fontFamily: font.b, color: h.danger },
  readOnlyBanner: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingBottom: spacing.md },
  readOnlyText: { fontFamily: font.sb, fontSize: 12.5, color: h.tealText, backgroundColor: h.tealWash, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, overflow: 'hidden' },
  cannedScroll: { flexGrow: 0, height: 52, backgroundColor: h.surface },
  cannedRow: { alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, gap: 8 },
  cannedChip: { height: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 20, backgroundColor: h.surface, borderWidth: 1, borderColor: 'rgba(14,143,163,0.35)' },
  cannedChipText: { fontFamily: font.sb, fontSize: 13.5, color: h.tealText },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: h.line07, backgroundColor: h.surface },
  inputWrap: { flex: 1, fontFamily: font.m, fontSize: 14.5, color: h.ivory, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line06, borderRadius: 26, paddingHorizontal: 20, paddingVertical: 14, minHeight: 52, maxHeight: 110 },
  sendBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: h.tealCta, alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 18px rgba(14,143,163,0.28)' },
  sendBtnDisabled: { opacity: 0.4 },
  pressedScale: { transform: [{ scale: 0.97 }] },
})
