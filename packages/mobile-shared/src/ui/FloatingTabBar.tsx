import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { font, geo, h, shadow } from '../theme/brand'
import { NavIcon, type NavName } from './NavIcon'
import { Press } from './Press'
import { PulseDot } from './PulseDot'

export type TabDef = { route: string; label: string; icon: NavName; badge?: boolean }

/** Distance from the screen bottom to the floating pill (reference: 16px; lifted above a system nav bar). */
export const useNavBottom = () => {
  const inset = useSafeAreaInsets().bottom
  return inset > 0 ? inset + 8 : geo.navBottom
}

/** Bottom padding a scroll view needs to clear the pill (110 in the reference + any nav-bar inset). */
export const useNavClearance = () => geo.scrollClearance + useNavBottom() - geo.navBottom

// Structural subset of react-navigation's BottomTabBarProps, all this bar reads.
type BarProps = {
  state: { index: number; routes: { key: string; name: string }[] }
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean }
    navigate: (name: string) => void
  }
}

export function FloatingTabBar({ state, navigation, tabs }: BarProps & { tabs: TabDef[] }) {
  const bottom = useNavBottom()
  const inset = useSafeAreaInsets().bottom
  const active = state.routes[state.index]?.name
  return (
    <View style={styles.host} pointerEvents="box-none">
      {/* .nav-fade, the canvas tint that lifts the pill off scrolling content */}
      <LinearGradient
        colors={['rgba(246,251,251,0)', 'rgba(246,251,251,0.55)', 'rgba(246,251,251,0.9)']}
        locations={[0, 0.62, 1]}
        style={[styles.fade, { bottom: inset }]}
        pointerEvents="none"
      />
      {/* solid canvas under the system nav bar so scrolled content never ghosts behind it */}
      {inset > 0 ? <View style={[styles.navCover, { height: inset }]} pointerEvents="none" /> : null}
      <View style={[styles.nav, { bottom }]}>
        {tabs.map((t) => {
          const route = state.routes.find((r) => r.name === t.route)
          const isActive = active === t.route
          return (
            <Press
              key={t.route}
              hit={styles.tabHit}
              style={styles.tab}
              label={t.label}
              onPress={() => {
                if (!route) return
                const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
                if (!isActive && !e.defaultPrevented) navigation.navigate(route.name)
              }}
            >
              {(p) => <Tab label={t.label} icon={t.icon} active={isActive} badge={t.badge} p={p} />}
            </Press>
          )
        })}
      </View>
    </View>
  )
}

function Tab({ label, icon, active, badge, p }: { label: string; icon: NavName; active: boolean; badge?: boolean | undefined; p: { get: () => number } }) {
  const svg = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.12 * p.get() }] }))
  return (
    <View style={{ alignItems: 'center', gap: 4, opacity: active ? 1 : 0.62 }}>
      <View>
        <Animated.View style={svg}>
          <NavIcon name={icon} active={active} />
        </Animated.View>
        {/* Persistent across every tab, not just the Home banner, a driver browsing Earnings or
            Profile still sees that something's blocking them from going online. */}
        {badge ? (
          <View style={styles.badge} pointerEvents="none">
            <PulseDot size={7} />
          </View>
        ) : null}
      </View>
      <Text maxFontSizeMultiplier={1.15} style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 },
  navCover: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: h.canvas },
  fade: { position: 'absolute', left: 0, right: 0, height: 100 },
  // the reference pill, shape / border / shadow unchanged, only the fill is now the solid app canvas
  nav: {
    position: 'absolute',
    left: geo.gutter,
    right: geo.gutter,
    height: geo.navHeight,
    borderRadius: 26,
    backgroundColor: h.canvas,
    borderWidth: 1,
    borderColor: h.line09,
    boxShadow: shadow.lg,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  tabHit: { flex: 1, marginVertical: 8, marginHorizontal: 4 },
  tab: { flex: 1, justifyContent: 'center', borderRadius: 18 },
  badge: { position: 'absolute', top: -1, right: -3 },
  label: { fontFamily: font.m, fontSize: 10.5, color: h.ivory },
  labelActive: { fontFamily: font.sb, color: h.teal },
})
