import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { font, h } from '@ocar/mobile-shared'

export type PlaceRowProps = {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  address: string
  onPress: () => void
  last?: boolean
  /** Pre-formatted distance from pickup (e.g. "3.2 km"), shown right-aligned. */
  distance?: string | undefined
  /** 'teal' tints the icon chip (Popular places); default is the neutral chip. */
  tone?: 'neutral' | 'teal'
}

// One shared row shape for live autocomplete results, recent searches, and
// favourite (saved) places -- all three lists in the redesigned search screen
// render through this, so switching between them never changes row height,
// icon size, or spacing (the exact instability this replaced).
export function PlaceRow({ icon, label, address, onPress, last, distance, tone = 'neutral' }: PlaceRowProps) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${address}`}
      >
        <View style={[styles.iconWrap, tone === 'teal' ? { backgroundColor: h.tealWash } : null]}>
          <Feather name={icon} size={18} color={tone === 'teal' ? h.tealText : h.ivory} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          <Text style={styles.address} numberOfLines={1}>{address}</Text>
        </View>
        {distance ? <Text style={styles.distance}>{distance}</Text> : null}
      </Pressable>
      {!last ? <View style={styles.divider} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  rowPressed: { backgroundColor: '#F4F8F8' },
  iconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  textCol: { flex: 1, gap: 2 },
  label: { fontFamily: font.sb, fontSize: 15, color: h.ivory },
  address: { fontFamily: font.r, fontSize: 12.5, color: h.muted },
  distance: { fontFamily: font.sb, fontSize: 12.5, color: h.muted, flexShrink: 0, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: h.line07 },
})
