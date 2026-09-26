import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import { useBookingDraftStore } from '@/features/booking/store'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { ScheduleSheet, formatPickupTime } from '@/features/booking/components/ScheduleSheet'
import { StopsList } from '@/features/booking/components/StopsList'

const MAX_STOPS = 3

const HOUR_OPTIONS = [4, 6, 8, 10, 12] as const

const INCLUDED = [
  'Same driver for both legs, no second booking needed',
  'Fare covers travel, waiting time, and the return',
  'Minimum booking duration is 4 hours',
  'If you end early at a different location, return distance to pickup is added to your fare',
]

// Matches web's /round-trip (apps/user/app/(main)/round-trip/page.tsx): destination
// is already set via the search screen just left, so this screen's only job is the
// hour selector, then hand off to /booking/fare (web's equivalent of /select-ride)
// for vehicle category + final booking. Scheduling and multi-stop, both present on
// web, are skipped here -- neither exists yet on this app's one-way flow either.
export default function RoundTripScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const drop = useBookingDraftStore((s) => s.drop)
  const distanceKm = useBookingDraftStore((s) => s.distanceKm)
  const durationMin = useBookingDraftStore((s) => s.durationMin)
  const tripHours = useBookingDraftStore((s) => s.tripHours)
  const setTripHours = useBookingDraftStore((s) => s.setTripHours)
  const stops = useBookingDraftStore((s) => s.stops)
  const removeStop = useBookingDraftStore((s) => s.removeStop)
  const swapStop = useBookingDraftStore((s) => s.swapStop)
  const scheduledFor = useBookingDraftStore((s) => s.scheduledFor)
  const setScheduledFor = useBookingDraftStore((s) => s.setScheduledFor)
  const riderName = useBookingDraftStore((s) => s.riderName)
  const riderPhone = useBookingDraftStore((s) => s.riderPhone)
  const setRider = useBookingDraftStore((s) => s.setRider)
  const clearRider = useBookingDraftStore((s) => s.clearRider)
  const bookingForOther = riderName !== '' && riderPhone !== ''

  const [selectedHours, setSelectedHours] = useState<number | null>(tripHours)
  const [riderSheetOpen, setRiderSheetOpen] = useState(false)
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false)

  const canProceed = selectedHours !== null
  const buttonLabel = selectedHours === null ? 'Choose how many hours' : `Continue · ${selectedHours}h round trip`

  function handleProceed() {
    if (selectedHours === null) return
    setTripHours(selectedHours)
    router.push('/booking/fare')
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressedScale : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={17} color={colors.primaryDark} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Round Trip</Text>
          <Text style={styles.subtitle}>Driver stays and brings you back</Text>
        </View>
        <Pressable
          onPress={() => setRiderSheetOpen(true)}
          style={styles.riderPill}
          accessibilityRole="button"
          accessibilityLabel="Who's travelling"
        >
          <Feather name="user" size={12} color={colors.primaryDark} />
          <Text style={styles.riderPillText} numberOfLines={1}>{bookingForOther ? riderName : 'For me'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.routeCard}>
          <Feather name="map-pin" size={13} color={colors.ink600} />
          <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
        </View>

        {distanceKm !== null && durationMin !== null ? (
          <Text style={styles.routeMeta}>
            {`2 × ${distanceKm.toFixed(1)} km = ${(distanceKm * 2).toFixed(1)} km total · ${Math.round(durationMin)} min · both legs covered`}
          </Text>
        ) : null}

        <Pressable onPress={() => setScheduleSheetOpen(true)} style={styles.scheduleChip} accessibilityRole="button">
          <Feather name="clock" size={12} color={colors.primaryDark} />
          <Text style={styles.scheduleChipText}>{scheduledFor ? formatPickupTime(new Date(scheduledFor)) : 'Now'}</Text>
          {scheduledFor ? (
            <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityLabel="Reset to ride now">
              <Feather name="x" size={12} color={colors.primaryDark} />
            </Pressable>
          ) : null}
        </Pressable>

        <StopsList
          stops={stops}
          maxStops={MAX_STOPS}
          onAdd={() => router.push('/booking/add-stop')}
          onRemove={removeStop}
          onSwap={swapStop}
        />

        <View style={styles.hourCard}>
          <Text style={styles.hourLabel}>How long do you need the driver?</Text>
          <View style={styles.hourRow}>
            {HOUR_OPTIONS.map((h) => {
              const active = selectedHours === h
              return (
                <Pressable
                  key={h}
                  onPress={() => setSelectedHours(h)}
                  style={[styles.hourChip, active ? styles.hourChipActive : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.hourChipText, active ? styles.hourChipTextActive : null]}>{h}h</Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={styles.hourHint}>Minimum 4 hours · Driver stays with you throughout</Text>
        </View>

        <View style={styles.includedCard}>
          {INCLUDED.map((text) => (
            <View key={text} style={styles.includedRow}>
              <View style={styles.includedDot} />
              <Text style={styles.includedText}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Pressable
          onPress={handleProceed}
          disabled={!canProceed}
          style={({ pressed }) => [styles.proceedBtn, !canProceed ? styles.disabled : null, pressed && canProceed ? styles.pressedScale : null]}
          accessibilityRole="button"
        >
          <Text style={styles.proceedText}>{buttonLabel}</Text>
        </Pressable>
      </View>

      <RiderSheet
        visible={riderSheetOpen}
        onClose={() => setRiderSheetOpen(false)}
        riderName={riderName}
        riderPhone={riderPhone}
        onCommit={(name, phone) => { setRider(name, phone); setRiderSheetOpen(false) }}
        onClearToMyself={() => { clearRider(); setRiderSheetOpen(false) }}
      />
      <ScheduleSheet visible={scheduleSheetOpen} onClose={() => setScheduleSheetOpen(false)} onChange={setScheduledFor} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(20,23,26,0.08)', boxShadow: '0 2px 8px rgba(20,23,26,0.06), 0 1px 2px rgba(20,23,26,0.05)', alignItems: 'center', justifyContent: 'center' },
  pressedScale: { transform: [{ scale: 0.97 }] },
  headerText: { flex: 1 },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  subtitle: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  headerIcon: { width: 40, height: 40, borderRadius: 16, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface2, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, maxWidth: 110 },
  riderPillText: { ...typography.caption, color: colors.ink900, fontFamily: fonts.bold },
  scheduleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.primarySubtle, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2 },
  scheduleChipText: { ...typography.caption, color: colors.primaryDark, fontFamily: fonts.bold },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.md },
  routeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderLight, padding: spacing.md },
  routeText: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold, flex: 1 },
  routeMeta: { ...typography.caption, color: colors.ink600 },
  hourCard: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderLight, padding: spacing.md, gap: spacing.sm },
  hourLabel: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  hourRow: { flexDirection: 'row', gap: spacing.xs },
  hourChip: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: 12, backgroundColor: colors.primarySubtle, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  hourChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  hourChipText: { ...typography.label, color: colors.primary, fontFamily: fonts.bold },
  hourChipTextActive: { color: colors.inkInverse },
  hourHint: { ...typography.caption, color: colors.ink400 },
  includedCard: { backgroundColor: colors.primarySubtle, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  includedRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  includedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 },
  includedText: { ...typography.caption, color: colors.primaryDark, fontFamily: fonts.medium, flex: 1 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.bg },
  proceedBtn: { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: spacing.sm + 8, alignItems: 'center', justifyContent: 'center', minHeight: 54, boxShadow: '0 10px 24px rgba(14,143,163,0.28)' },
  disabled: { opacity: 0.5 },
  proceedText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
})
