import { useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { create } from 'zustand'
import { Button, SlideModal, Text, font, h } from '@ocar/mobile-shared'

// A drop-in for Alert.alert: same arguments, a premium bottom sheet instead of the stock Android dialog. Call
// `confirmDialog(title, message, [{ text, style, onPress }])` anywhere; <ConfirmHost /> is mounted once in the root layout.
export type ConfirmButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }

type Request = { title: string; message: string | undefined; buttons: ConfirmButton[] }
const useConfirmStore = create<{ request: Request | null; set: (r: Request | null) => void }>()((set) => ({ request: null, set: (request) => set({ request }) }))

export function confirmDialog(title: string, message?: string, buttons?: ConfirmButton[]) {
  useConfirmStore.getState().set({ title, message, buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }] })
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request)
  const close = () => useConfirmStore.getState().set(null)
  const insets = useSafeAreaInsets()
  // Keep the last request around while the sheet slides out, so it does not go blank mid-exit.
  const shown = useLastRequest(request)

  const destructive = shown?.buttons.some((b) => b.style === 'destructive') ?? false
  const actions = shown?.buttons.filter((b) => b.style !== 'cancel') ?? []
  const cancels = shown?.buttons.filter((b) => b.style === 'cancel') ?? []

  const press = (b: ConfirmButton) => { close(); b.onPress?.() }

  return (
    <SlideModal visible={request !== null} onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <View style={styles.handle} />
        <View style={[styles.badge, destructive ? styles.badgeDanger : styles.badgeInfo]}>
          <Feather name={destructive ? 'alert-triangle' : 'info'} size={22} color={destructive ? h.danger : h.tealText} />
        </View>
        <Text style={styles.title}>{shown?.title}</Text>
        {shown?.message ? <Text style={styles.message}>{shown.message}</Text> : null}

        <View style={styles.actions}>
          {actions.map((b) =>
            b.style === 'destructive' ? (
              <Pressable key={b.text} onPress={() => press(b)} accessibilityRole="button" style={({ pressed }) => [styles.danger, pressed ? styles.pressed : null]}>
                <Text style={styles.dangerText}>{b.text}</Text>
              </Pressable>
            ) : (
              <Button key={b.text} variant="cta" label={b.text} onPress={() => press(b)} />
            ),
          )}
          {cancels.map((b) => (
            <Button key={b.text} variant="soft" label={b.text} onPress={() => press(b)} />
          ))}
        </View>
      </View>
    </SlideModal>
  )
}

function useLastRequest(request: Request | null): Request | null {
  const last = useRef<Request | null>(null)
  if (request) last.current = request
  return request ?? last.current
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { backgroundColor: h.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 18, paddingTop: 12, boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 20 },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  badgeDanger: { backgroundColor: h.dangerWash },
  badgeInfo: { backgroundColor: h.tealWash },
  title: { fontFamily: font.xb, fontSize: 21, letterSpacing: -0.3, color: h.ivory },
  message: { fontFamily: font.m, fontSize: 14.5, lineHeight: 21, color: h.muted, marginTop: 6 },
  actions: { gap: 10, marginTop: 22 },
  danger: { height: 56, borderRadius: 18, backgroundColor: h.danger, alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 24px rgba(194,59,59,0.26)' },
  dangerText: { fontFamily: font.b, fontSize: 16, color: '#FFFFFF' },
  pressed: { transform: [{ scale: 0.98 }] },
})
