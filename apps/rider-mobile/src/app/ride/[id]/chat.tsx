import { useEffect, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, useRoomJoin } from '@ocar/mobile-shared'
import { socket } from '@/services/socket'
import { fetchChatMessages, markChatRead, sendChatMessage, type ChatMessage } from '@/features/ride-tracking/api'

export default function RideChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useRoomJoin(socket, rideId)

  useEffect(() => {
    fetchChatMessages(rideId).then(setMessages).catch(() => {})
    markChatRead(rideId).catch(() => {})
  }, [rideId])

  useEffect(() => {
    function onMessage(payload: ChatMessage & { rideId: string }) {
      if (String(payload.rideId) !== String(rideId)) return
      setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]))
      markChatRead(rideId).catch(() => {})
    }
    socket.on('chat:message', onMessage)
    return () => { socket.off('chat:message', onMessage) }
  }, [rideId])

  async function handleSend() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    try {
      const msg = await sendChatMessage(rideId, body, crypto.randomUUID())
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    } catch {
      setDraft(body)
    } finally {
      setSending(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const mine = item.senderType === 'user'
          return (
            <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : null]}>{item.body}</Text>
              </View>
            </View>
          )
        }}
      />
      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message your driver…"
          placeholderTextColor={colors.ink400}
          style={styles.input}
          multiline
          maxLength={1000}
        />
        <Pressable onPress={handleSend} disabled={!draft.trim() || sending} style={[styles.sendBtn, !draft.trim() ? styles.sendBtnDisabled : null]}>
          <Feather name="send" size={16} color={colors.inkInverse} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, gap: spacing.xs },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: radii.lg, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  bubbleMine: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  bubbleText: { ...typography.body, color: colors.ink900 },
  bubbleTextMine: { color: colors.inkInverse },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, ...typography.body, color: colors.ink900, backgroundColor: colors.surface2, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
})
