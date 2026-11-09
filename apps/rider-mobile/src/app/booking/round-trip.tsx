import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Button, font, h, spacing } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { useBookingDraftStore } from '@/features/booking/store'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { ScheduleSheet, formatPickupTime } from '@/features/booking/components/ScheduleSheet'
import { StopsList } from '@/features/booking/components/StopsList'

const MAX_STOPS = 3

const HOUR_OPTIONS = [4, 6, 8, 10, 12] as const

const INCLUDED = [
  'Same driver for both legs, no second booking needed',
  'Your booked hours cover travel and waiting. Extra time is billed by the minute after a short grace period',
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
        <IconButton icon="arrow-left" label="Go back" onPress={() => goBack(router)} />
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
          <Feather name="user" size={16} color={h.ivory} />
          <Text style={styles.riderPillText} numberOfLines={1}>{bookingForOther ? riderName : 'For me'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.routeCard}>
          <Feather name="map-pin" size={16} color={h.tealText} />
          <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
        </View>

        {distanceKm !== null && durationMin !== null ? (
          <Text style={styles.routeMeta}>
            {`2 × ${distanceKm.toFixed(1)} km = ${(distanceKm * 2).toFixed(1)} km total · ${Math.round(durationMin)} min · both legs covered`}
          </Text>
        ) : null}

        <Pressable onPress={() => setScheduleSheetOpen(true)} style={styles.scheduleChip} accessibilityRole="button">
          <Feather name="clock" size={14} color={h.tealText} />
          <Text style={styles.scheduleChipText}>{scheduledFor ? formatPickupTime(new Date(scheduledFor)) : 'Now'}</Text>
          {scheduledFor ? (
            <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityLabel="Reset to ride now">
              <Feather name="x" size={14} color={h.tealText} />
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
            {HOUR_OPTIONS.map((hrs) => {
              const active = selectedHours === hrs
              return (
                <Pressable
                  key={hrs}
                  onPress={() => setSelectedHours(hrs)}
                  style={[styles.hourChip, active ? styles.hourChipActive : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.hourChipText, active ? styles.hourChipTextActive : null]}>{hrs}h</Text>
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
        <LinearGradient pointerEvents="none" colors={['rgba(246,251,251,0)', h.canvas]} style={styles.fade} />
        <Button variant="cta" label={buttonLabel} onPress={handleProceed} disabled={!canProceed} />
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
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  headerText: { flex: 1 },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory },
  subtitle: { fontFamily: font.r, fontSize: 12.5, color: h.muted, marginTop: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line08, maxWidth: 130 },
  riderPillText: { fontFamily: font.sb, fontSize: 14, color: h.ivory, flexShrink: 1 },
  scheduleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40, backgroundColor: h.tealWash, borderRadius: 999, paddingHorizontal: 14 },
  scheduleChipText: { fontFamily: font.sb, fontSize: 13, color: h.tealText },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 14 },
  routeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: h.surface, borderRadius: 20, borderWidth: 1, borderColor: h.line07, boxShadow: '0 2px 8px rgba(20,23,26,0.05)', padding: 16 },
  routeText: { fontFamily: font.sb, fontSize: 15, color: h.ivory, flex: 1 },
  routeMeta: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginHorizontal: 2, fontVariant: ['tabular-nums'] },
  hourCard: { backgroundColor: h.surface, borderRadius: 22, borderWidth: 1, borderColor: h.line07, boxShadow: '0 2px 8px rgba(20,23,26,0.05)', padding: 16, gap: 12 },
  hourLabel: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  hourRow: { flexDirection: 'row', gap: 8 },
  hourChip: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: h.chip, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  hourChipActive: { backgroundColor: h.tealCta, borderColor: h.tealCta },
  hourChipText: { fontFamily: font.b, fontSize: 14, color: h.ivory, fontVariant: ['tabular-nums'] },
  hourChipTextActive: { color: '#FFFFFF' },
  hourHint: { fontFamily: font.m, fontSize: 12.5, color: h.muted },
  includedCard: { backgroundColor: h.tealWash, borderRadius: 22, padding: 16, gap: 10 },
  includedRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  includedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: h.teal, marginTop: 7 },
  includedText: { fontFamily: font.m, fontSize: 13, lineHeight: 19, color: h.tealText, flex: 1 },
  fade: { position: 'absolute', left: 0, right: 0, top: -40, height: 40 },
  footer: { paddingHorizontal: 18, paddingTop: 10, backgroundColor: h.canvas },
})
