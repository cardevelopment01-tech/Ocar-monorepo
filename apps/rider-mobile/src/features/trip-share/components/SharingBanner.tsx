import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { bannerText } from '../model'

/** A slim line while the trip is being shared: tap it to see who can follow, or Stop to end every link (after a confirmation). */
export function SharingBanner({ count, onManage, onStop }: { count: number; onManage: () => void; onStop: () => void }) {
  if (count <= 0) return null
  return (
    <View style={styles.bar}>
      <Pressable onPress={onManage} accessibilityRole="button" accessibilityLabel={`${bannerText(count)}. Manage`} style={styles.main}>
        <Feather name="share-2" size={15} color={colors.primaryDark} />
        <Text style={styles.text} numberOfLines={1}>{bannerText(count)}</Text>
      </Pressable>
      <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="Stop sharing" hitSlop={6} style={styles.stop}>
        <Text style={styles.stopText}>Stop</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: radii.full, backgroundColor: colors.primarySubtle, paddingLeft: spacing.md },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  text: { ...typography.label, color: colors.primaryDark, fontFamily: fonts.bold, flexShrink: 1 },
  stop: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  stopText: { ...typography.label, color: colors.error, fontFamily: fonts.bold },
})
