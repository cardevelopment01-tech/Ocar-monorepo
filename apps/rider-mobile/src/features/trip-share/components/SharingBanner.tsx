import { StyleSheet, Text } from 'react-native'
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { Press, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { bannerText } from '../model'

/**
 * A slim line while the trip is being shared: tap it to see who can follow, or Stop to end every link (after a confirmation).
 * It slides in when sharing starts and out when it ends, and the rest of the sheet moves smoothly to make room.
 */
export function SharingBanner({ count, onManage, onStop }: { count: number; onManage: () => void; onStop: () => void }) {
  if (count <= 0) return null
  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOutUp.duration(180)} layout={LinearTransition.duration(240)} style={styles.bar}>
      <Press onPress={onManage} accessibilityRole="button" accessibilityLabel={`${bannerText(count)}. Manage`} scaleTo={0.985} hit={styles.mainHit} style={styles.main}>
        <Feather name="share-2" size={15} color={colors.primaryDark} />
        <Text style={styles.text} numberOfLines={1}>{bannerText(count)}</Text>
      </Press>
      <Press onPress={onStop} accessibilityRole="button" accessibilityLabel="Stop sharing" hitSlop={6} scaleTo={0.92} style={styles.stop}>
        <Text style={styles.stopText}>Stop</Text>
      </Press>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: radii.full, backgroundColor: colors.primarySubtle, paddingLeft: spacing.md },
  mainHit: { flex: 1 },
  main: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  text: { ...typography.label, color: colors.primaryDark, fontFamily: fonts.bold, flexShrink: 1 },
  stop: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  stopText: { ...typography.label, color: colors.error, fontFamily: fonts.bold },
})
