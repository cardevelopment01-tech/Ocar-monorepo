import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, useKeyboardOffset, fonts } from '@ocar/mobile-shared'
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
            <Text style={styles.title}>Add a stop</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Feather name="x" size={16} color={colors.ink600} />
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
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xl, minHeight: 260 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,23,26,0.16)', alignSelf: 'center', marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  closeBtn: { width: 32, height: 32, borderRadius: radii.full, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
})
