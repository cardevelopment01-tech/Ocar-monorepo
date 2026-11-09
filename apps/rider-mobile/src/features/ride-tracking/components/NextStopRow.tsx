import { Pressable, StyleSheet, Text, View } from 'react-native'
import { font, h } from '@ocar/mobile-shared'
import type { RideStop } from '@ocar/mobile-shared'

export type NextStopRowProps = {
  stop: RideStop
  position: number
  total: number
  busy?: boolean
  onSkip: (stop: RideStop) => void
}

// The next pending stop with its Skip, always visible. Skip used to live only inside the
// collapsed "Trip details" sheet, so riders who never opened it reported having no option.
export function NextStopRow({ stop, position, total, busy = false, onSkip }: NextStopRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>Next stop · {position} of {total}</Text>
        <Text style={styles.address} numberOfLines={1}>{stop.address ?? `Stop ${stop.sequence}`}</Text>
      </View>
      <Pressable
        onPress={() => onSkip(stop)}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Skip stop ${stop.sequence}`}
        style={({ pressed }) => [styles.skip, pressed && styles.pressed, busy && styles.busy]}
      >
        <Text style={styles.skipText}>{busy ? 'Skipping…' : 'Skip'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: h.chip, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16 },
  text: { flex: 1 },
  label: { fontFamily: font.sb, fontSize: 11.5, color: h.label },
  address: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  skipText: { fontFamily: font.b, fontSize: 13.5, color: h.danger },
  pressed: { opacity: 0.6 },
  busy: { opacity: 0.5 },
})
