import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { font, h, useKeyboardOffset } from '@ocar/mobile-shared'
import { PlaceAutocompleteField } from '@/features/booking/components/PlaceAutocompleteField'
import type { StopInput } from '../api'

export type AddStopSheetProps = {
  visible: boolean
  originLat: number
  originLng: number
  onClose: () => void
  onSelect: (stop: StopInput) => void
}

export function AddStopSheet({ visible, originLat, originLng, onClose, onSelect }: AddStopSheetProps) {
  const [picked, setPicked] = useState<{ address: string; lat: number; lng: number } | null>(null)
  const keyboardOffset = useKeyboardOffset()
  // This Modal had no keyboard handling at all -- the sheet is docked to the
  // bottom (justifyContent: 'flex-end'), so the search input sat directly
  // behind the keyboard the instant it was focused, with zero reflow.
  const keyboardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -keyboardOffset.get() }] }))

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.sheet, keyboardStyle]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add a stop</Text>
              <Text style={styles.sub}>Your driver will stop here on the way to the drop.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Feather name="x" size={16} color={h.muted} />
            </Pressable>
          </View>
          <PlaceAutocompleteField
            label="Stop location"
            placeholder="Search for a place…"
            accessibilityHint="Search for an address to add as a stop"
            bias={{ lat: originLat, lng: originLng }}
            value={picked}
            onSelect={(place) => {
              setPicked(place)
              onSelect(place)
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.5)' },
  sheet: { backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 30, minHeight: 300, boxShadow: '0 -12px 32px rgba(20,23,26,0.16)' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.14)', alignSelf: 'center', marginBottom: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  title: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  sub: { fontFamily: font.r, fontSize: 13.5, lineHeight: 19, color: h.muted, marginTop: 3 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
})
