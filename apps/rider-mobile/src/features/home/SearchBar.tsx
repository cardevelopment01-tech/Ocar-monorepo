import { StyleSheet, View } from 'react-native'
import { Text } from './Text'
import Animated, { type SharedValue, interpolateColor, useAnimatedStyle } from 'react-native-reanimated'
import { font, h } from '@/theme/homeTokens'
import { CalendarIcon, SearchIcon } from './icons'
import { Press } from './Press'

export const SEARCH_BAR_HEIGHT = 58

/** `.searchbar`. Rendered twice by Home: once in the sheet's flow and once as the pinned
 *  copy (`stuck`, border .09 -> .13) that takes over below the status bar. */
export function SearchBar({ onPress, onLater, stuck = false }: { onPress: () => void; onLater: () => void; stuck?: boolean }) {
  return (
    <Press onPress={onPress} scaleTo={0.985} label="Where to?" style={[styles.bar, stuck && styles.barStuck]}>
      <View style={styles.icon}>
        <SearchIcon />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        Where to?
      </Text>
      <Press onPress={onLater} scaleTo={0.94} duration={150} label="Schedule for later" style={styles.later}>
        {(p) => (
          <>
            <LaterPress p={p} />
            <View style={styles.laterIcon}>
              <CalendarIcon />
            </View>
            <Text style={styles.laterLabel}>Later</Text>
          </>
        )}
      </Press>
    </Press>
  )
}

function LaterPress({ p }: { p: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.get(), [0, 1], [h.chip, '#EBECEC']) }))
  return <Animated.View style={[StyleSheet.absoluteFill, styles.laterFill, style]} />
}

const styles = StyleSheet.create({
  bar: {
    height: SEARCH_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: h.line09,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  barStuck: { borderColor: h.line13 },
  icon: { opacity: 0.58 },
  text: { flex: 1, minWidth: 0, fontFamily: font.r, fontSize: 16, color: 'rgba(20,23,26,0.66)' },
  later: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  laterFill: { borderRadius: 999 },
  laterIcon: { opacity: 0.8 },
  laterLabel: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
})
