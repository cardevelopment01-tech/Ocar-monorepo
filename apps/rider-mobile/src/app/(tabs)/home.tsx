import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { useRideHistory } from '@/features/ride-history/hooks/useRideHistory'
import { useBookingDraftStore } from '@/features/booking/store'
import type { RideType } from '@/features/booking/api'

// Static, matching the real web home page's own hardcoded SAVED/POPULAR constants
// (apps/user/app/(main)/home/page.tsx) -- not wired to a saved-places API since
// none exists yet on either platform (see CLAUDE.md's Known UI Caveats).
const SAVED = [
  { icon: 'home' as const, label: 'Home', sub: 'Sahid Nagar, Bhubaneswar' },
  { icon: 'briefcase' as const, label: 'Work', sub: 'Infocity, Chandrasekharpur' },
]
const POPULAR = [
  { from: 'Bhubaneswar', to: 'Cuttack' },
  { from: 'Bhubaneswar', to: 'Puri' },
  { from: 'Cuttack', to: 'Bhubaneswar' },
  { from: 'Puri', to: 'Bhubaneswar' },
]

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function PressableScale({ children, onPress, style }: { children: React.ReactNode; onPress: () => void; style?: object }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, pressed ? { transform: [{ scale: 0.97 }] } : null]}
    >
      {children}
    </Pressable>
  )
}

export default function HomeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const user = useAuthStore((s) => s.user)
  const { items, loading } = useRideHistory()
  const setRideType = useBookingDraftStore((s) => s.setRideType)
  const firstName = user?.name?.split(' ')[0] ?? 'there'

  function toBooking(rideType: RideType) {
    setRideType(rideType, true)
    router.push('/booking')
  }

  // Search bar, saved places, recent trips, popular routes -- none of these
  // declare a ride type (matches web's /search reached with no `rideType`
  // URL param). /booking's Continue classifies the chosen destination itself
  // once it's known and picks one_way/round_trip/rental accordingly, instead
  // of every quick-pick silently forcing one_way regardless of destination.
  function toBookingAuto() {
    setRideType('one_way', false)
    router.push('/booking')
  }

  const recentTrips = useMemo(
    () => items.filter((r) => r.status === 'completed').slice(0, 2),
    [items]
  )

  // Scroll offset drives the hero's collapse -- state indication (you've
  // scrolled past the greeting), computed entirely on the UI thread. No
  // setState per scroll frame. Matches the real web app's Home.tsx, which
  // collapses the greeting's height to 0 on scroll so the search bar rises
  // up flush under the top bar, rather than just fading it in place.
  const scrollY = useSharedValue(0)
  const greetingHeight = useSharedValue(0)
  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y)
  })
  const greetingStyle = useAnimatedStyle(() => {
    const h = greetingHeight.get()
    if (h === 0) return { opacity: 1 }
    const collapse = interpolate(scrollY.get(), [0, 24], [1, 0], 'clamp')
    return {
      opacity: collapse,
      height: h * collapse,
      marginBottom: spacing.md * collapse,
    }
  })

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.heroTopBar}>
          <Text style={styles.logoText}>Ocar</Text>
          <View style={styles.heroActions}>
            <Pressable style={styles.heroIconButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Profile">
              <Feather name="user" size={16} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
        </View>

        <Animated.View
          style={[styles.greetingWrap, greetingStyle]}
          onLayout={(e) => {
            if (greetingHeight.get() === 0) greetingHeight.set(e.nativeEvent.layout.height)
          }}
        >
          <Text style={styles.greetingLabel}>{greeting()}</Text>
          <Text style={styles.greetingName}>{firstName} ðŸ‘‹</Text>
        </Animated.View>

        <Pressable
          style={({ pressed }) => [styles.searchBar, pressed ? styles.searchBarPressed : null]}
          onPress={toBookingAuto}
          accessibilityRole="search"
          accessibilityLabel="Where to?"
        >
          <Feather name="search" size={17} color={colors.ink400} />
          <Text style={styles.searchPlaceholder}>Where to?</Text>
          <View style={styles.searchGoPill}>
            <Text style={styles.searchGoText}>Go</Text>
          </View>
        </Pressable>
      </View>

      <Animated.ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <View style={styles.servicesRow}>
          <PressableScale style={styles.serviceCard} onPress={() => toBooking('one_way')}>
            <View style={styles.serviceIconWrap}>
              <Feather name="navigation" size={18} color={colors.primary} />
            </View>
            <Text style={styles.serviceLabel}>One Way</Text>
            <Text style={styles.serviceSub}>Best fare</Text>
          </PressableScale>
          <PressableScale style={styles.serviceCard} onPress={() => toBooking('round_trip')}>
            <View style={styles.serviceIconWrap}>
              <Feather name="repeat" size={18} color={colors.primary} />
            </View>
            <Text style={styles.serviceLabel}>Round Trip</Text>
            <Text style={styles.serviceSub}>Driver stays</Text>
          </PressableScale>
          <PressableScale style={styles.serviceCard} onPress={() => toBooking('rental')}>
            <View style={styles.serviceIconWrap}>
              <Feather name="clock" size={18} color={colors.primary} />
            </View>
            <Text style={styles.serviceLabel}>City Rides</Text>
            <Text style={styles.serviceSub}>Hourly</Text>
          </PressableScale>
        </View>

        <View style={styles.card}>
          {SAVED.map((p, i) => (
            <PressableScale
              key={p.label}
              style={[styles.listRow, i < SAVED.length - 1 ? styles.listRowDivider : null]}
              onPress={toBookingAuto}
            >
              <View style={styles.rowIconWrap}>
                <Feather name={p.icon} size={15} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{p.label}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{p.sub}</Text>
              </View>
              <Feather name="chevron-right" size={14} color={colors.ink400} />
            </PressableScale>
          ))}
        </View>

        {!loading && recentTrips.length > 0 ? (
          <View style={styles.card}>
            {recentTrips.map((r, i) => (
              <PressableScale
                key={r.id}
                style={[styles.listRow, i < recentTrips.length - 1 ? styles.listRowDivider : null]}
                onPress={toBookingAuto}
              >
                <View style={styles.rowIconWrapMuted}>
                  <Feather name="map-pin" size={14} color={colors.ink400} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{r.destinationAddress ?? 'Unknown destination'}</Text>
                  <Text style={styles.rowSub}>
                    {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Text>
                </View>
                <Feather name="chevron-right" size={14} color={colors.ink400} />
              </PressableScale>
            ))}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Popular routes</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.popularRow}>
          {POPULAR.map((r) => (
            <PressableScale key={`${r.from}-${r.to}`} style={styles.popularChip} onPress={toBookingAuto}>
              <Text style={styles.popularFrom}>{r.from}</Text>
              <Feather name="arrow-right" size={10} color={colors.ink400} />
              <Text style={styles.popularTo}>{r.to}</Text>
            </PressableScale>
          ))}
        </ScrollView>

        <View style={styles.promoCard}>
          <View style={styles.promoText}>
            <Text style={styles.promoTitle}>20% off your first ride</Text>
            <Text style={styles.promoSub}>New to Ocar? Use code at checkout</Text>
            <View style={styles.promoCodePill}>
              <Text style={styles.promoCode}>OCAR20</Text>
            </View>
          </View>
          <Text style={styles.promoEmoji}>ðŸŽ‰</Text>
        </View>
      </Animated.ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  greetingWrap: { overflow: 'hidden' },
  logoText: { ...typography.title, color: colors.inkInverse, fontWeight: '700' },
  heroActions: { flexDirection: 'row', gap: spacing.xs },
  heroIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  greetingLabel: { ...typography.label, color: 'rgba(255,255,255,0.5)' },
  greetingName: { ...typography.headline, color: colors.inkInverse, marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  searchBarPressed: { opacity: 0.85 },
  searchPlaceholder: { ...typography.body, color: colors.ink400, flex: 1 },
  searchGoPill: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  searchGoText: { ...typography.label, color: colors.inkInverse, fontWeight: '700' },
  content: { flex: 1 },
  contentInner: { padding: spacing.md, paddingBottom: spacing['2xl'], gap: spacing.md },
  servicesRow: { flexDirection: 'row', gap: spacing.sm },
  serviceCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  serviceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceLabel: { ...typography.label, color: colors.ink900, fontWeight: '600' },
  serviceSub: { ...typography.caption, color: colors.ink400 },
  card: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  listRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconWrapMuted: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.label, color: colors.ink900, fontWeight: '600' },
  rowSub: { ...typography.caption, color: colors.ink400 },
  sectionLabel: { ...typography.label, color: colors.ink600, fontWeight: '600' },
  popularRow: { flexGrow: 0 },
  popularChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginRight: spacing.xs,
  },
  popularFrom: { ...typography.caption, color: colors.ink600, fontWeight: '500' },
  popularTo: { ...typography.caption, color: colors.ink900, fontWeight: '700' },
  promoCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  promoText: { flex: 1, gap: 2 },
  promoTitle: { ...typography.label, color: colors.ink900, fontWeight: '700' },
  promoSub: { ...typography.caption, color: colors.ink400 },
  promoCodePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySubtle,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: spacing.xs,
  },
  promoCode: { ...typography.caption, color: colors.primaryDark, fontWeight: '700', letterSpacing: 1 },
  promoEmoji: { fontSize: 28 },
})

