import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { goBack } from '@/lib/goBack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, font, h } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { useBookingDraftStore } from '@/features/booking/store'
import { RiderSheet } from '@/features/booking/components/RiderSheet'
import { ScheduleSheet, formatPickupTime } from '@/features/booking/components/ScheduleSheet'
import { RouteRail, StopsSummaryRow } from '@/features/booking/components/StopsList'
import { MAX_STOPS } from '@/features/booking/constants'
import { PackageSlider, type PackageTileData } from '@/components/ui/PackageSlider'


const HOUR_OPTIONS = [4, 6, 8, 10, 12] as const

const INCLUDED = [
  'Same driver for both legs, no second booking needed.',
  'Your booked hours cover travel and waiting. Extra time is billed by the minute after a short grace period.',
  'Minimum booking duration is 4 hours.',
  'If you end early at a different location, the return distance to pickup is added to your fare.',
]

// "1h 10m", "2h", "45m": the style the design uses for waits and legs.
function dur(m: number): string {
  const r = Math.round(m)
  if (r < 60) return `${r}m`
  return r % 60 === 0 ? `${r / 60}h` : `${Math.floor(r / 60)}h ${r % 60}m`
}

// Matches web's /round-trip (apps/user/app/(main)/round-trip/page.tsx): destination
// is already set via the search screen just left, so this screen's only job is the
// hour selector, then hand off to /booking/fare (web's equivalent of /select-ride)
// for vehicle category + final booking. Scheduling and multi-stop, both present on
// web, are skipped here -- neither exists yet on this app's one-way flow either.
export default function RoundTripScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const distanceKm = useBookingDraftStore((s) => s.distanceKm)
  const durationMin = useBookingDraftStore((s) => s.durationMin)
  const tripHours = useBookingDraftStore((s) => s.tripHours)
  const setTripHours = useBookingDraftStore((s) => s.setTripHours)
  const stops = useBookingDraftStore((s) => s.stops)
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
  const [knowOpen, setKnowOpen] = useState(false)

  const canProceed = selectedHours !== null
  // Both legs of driving come from the real route estimate (durationMin is one way), never a fixed figure. Stops and traffic
  // move it, so every derived line is worded "about".
  const legMin = durationMin !== null ? Math.round(durationMin) : null
  const travelMin = legMin !== null ? legMin * 2 : null
  // Smallest option whose hours cover both legs. With no route estimate (or when even the longest cannot) there is no best fit.
  const bestHours = travelMin === null ? null : HOUR_OPTIONS.find((hrs) => hrs * 60 >= travelMin) ?? null
  const tiles: PackageTileData[] = HOUR_OPTIONS.map((hrs) => {
    const wait = travelMin === null ? null : hrs * 60 - travelMin
    return { id: hrs, hours: String(hrs), unit: 'hrs', km: wait === null ? 'Driver stays' : wait < 0 ? 'Tight' : `${dur(wait)} wait`, warn: wait !== null && wait < 0 }
  })
  const startMs = scheduledFor ? new Date(scheduledFor).getTime() : Date.now()
  const startText = scheduledFor ? formatPickupTime(new Date(scheduledFor)) : `Now, ${formatPickupTime(new Date()).replace('Today, ', '')}`
  const returnText = selectedHours !== null ? formatPickupTime(new Date(startMs + selectedHours * 3_600_000)) : null
  const overMin = selectedHours !== null && travelMin !== null ? Math.max(0, travelMin - selectedHours * 60) : 0
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
          <Text style={styles.title}>Round trip</Text>
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
        {/* Route card: when, pickup, one stops row, drop, the way back, and what both legs add up to. */}
        <View style={styles.tripCard}>
          <View style={styles.tripRow}>
            <Pressable onPress={() => setScheduleSheetOpen(true)} style={styles.scheduleChip} accessibilityRole="button">
              <Feather name="clock" size={15} color={h.tealText} />
              <Text style={styles.scheduleChipText}>{scheduledFor ? formatPickupTime(new Date(scheduledFor)) : 'Now'}</Text>
              {scheduledFor ? (
                <Pressable onPress={() => setScheduledFor(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset to ride now">
                  <Feather name="x" size={13} color={h.tealText} />
                </Pressable>
              ) : null}
            </Pressable>
            {distanceKm !== null ? <Text style={styles.tripMeta}>{`${(distanceKm * 2).toFixed(1)} km total`}</Text> : null}
          </View>

          <View style={[styles.routeRow, { minHeight: 38 }]}>
            <RouteRail line="down"><View style={styles.pickupDot} /></RouteRail>
            <Text style={styles.routeText} numberOfLines={1}>{pickup?.address ?? 'Pickup location'}</Text>
          </View>
          {stops.length > 0 ? (
            <StopsSummaryRow stops={stops} maxStops={MAX_STOPS} onEdit={() => router.push('/booking/plan-stops')} onAdd={() => router.push('/booking/add-stop')} />
          ) : (
            <Pressable
              onPress={() => router.push('/booking/add-stop')}
              style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}
              accessibilityRole="button"
              accessibilityLabel="Add a stop, optional"
            >
              <RouteRail line="full">
                <View style={styles.addDot}><Feather name="plus" size={10} color={h.tealText} /></View>
              </RouteRail>
              <Text style={styles.addText}>Add a stop</Text>
              <Text style={styles.addOptional}>Optional</Text>
            </Pressable>
          )}
          <View style={[styles.routeRow, { minHeight: 38 }]}>
            <RouteRail line="full"><View style={styles.dropDot} /></RouteRail>
            <Text style={styles.routeText} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
          </View>
          <View style={[styles.routeRow, { minHeight: 34 }]}>
            <RouteRail line="up"><View style={styles.backDot} /></RouteRail>
            <Text style={styles.backText} numberOfLines={1}>Back to pickup, same driver</Text>
          </View>

          {distanceKm !== null && legMin !== null ? (
            <View style={styles.tripFoot}>
              <Feather name="repeat" size={15} color={h.tealText} />
              <Text style={styles.tripFootText}>{`2 × ${distanceKm.toFixed(1)} km · ${legMin} min each way`}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.askBlock}>
          <Text style={styles.askTitle}>How long do you need the driver?</Text>
          <Text style={styles.askSub}>Minimum 4 hours. The driver stays with you throughout.</Text>
        </View>

        <View style={styles.hourCard}>
          <PackageSlider
            tone="teal"
            arrowLabel="durations"
            tiles={tiles}
            selectedId={selectedHours}
            bestId={bestHours}
            onSelect={setSelectedHours}
          />

          {selectedHours !== null ? (
            <>
              <View style={styles.timeRow}>
                <View style={styles.timeCol}>
                  <Text style={styles.timeLabel}>Starts</Text>
                  <Text style={styles.timeValue} numberOfLines={2}>{startText}</Text>
                </View>
                <View style={styles.timeDivider} />
                <View style={styles.timeCol}>
                  <Text style={styles.timeLabel}>Return by</Text>
                  <Text style={[styles.timeValue, { color: h.tealText }]} numberOfLines={2}>{returnText}</Text>
                </View>
              </View>

              {travelMin !== null ? (
                <View style={[styles.estimate, overMin > 0 ? styles.estimateWarn : null]}>
                  <Feather name={overMin > 0 ? 'alert-circle' : 'check-circle'} size={16} color={overMin > 0 ? '#9A6A12' : h.tealText} style={styles.estimateIcon} />
                  <Text style={[styles.estimateText, overMin > 0 ? { color: '#5A4310' } : null]}>
                    {overMin > 0
                      ? `Both legs alone take about ${dur(travelMin)}, which is ${dur(overMin)} more than you booked. That time is billed by the minute.${bestHours !== null ? ` Pick ${bestHours} hrs to avoid it.` : ''}`
                      : `Both legs take about ${dur(travelMin)}, so the driver waits about ${dur(selectedHours * 60 - travelMin)}. Extra time is billed by the minute after a short grace period.`}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        <View style={styles.knowCard}>
          <Pressable
            onPress={() => setKnowOpen((o) => !o)}
            style={({ pressed }) => [styles.knowHead, pressed ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityState={{ expanded: knowOpen }}
            accessibilityLabel="Good to know"
          >
            <View style={styles.knowIcon}><Feather name="info" size={16} color={h.tealText} /></View>
            <Text style={styles.knowTitle}>Good to know</Text>
            <Feather name={knowOpen ? 'chevron-up' : 'chevron-down'} size={18} color={h.faint} />
          </Pressable>
          {knowOpen ? (
            <View style={styles.knowBody}>
              {INCLUDED.map((text) => (
                <View key={text} style={styles.knowRow}>
                  <Feather name="check" size={16} color={h.tealText} style={styles.knowCheck} />
                  <Text style={styles.knowText}>{text}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory },
  subtitle: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginTop: 1 },
  riderPill: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingLeft: 12, paddingRight: 14, borderRadius: 18, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line06, maxWidth: 130 },
  riderPillText: { fontFamily: font.b, fontSize: 13.5, color: h.ivory, flexShrink: 1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
  pressed: { opacity: 0.7 },

  tripCard: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, borderRadius: 22, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 4, boxShadow: '0 2px 8px rgba(20,23,26,0.05), inset 0 1px 0 rgba(255,255,255,0.9)' },
  tripRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  tripMeta: { fontFamily: font.sb, fontSize: 13.5, color: h.muted, fontVariant: ['tabular-nums'] },
  scheduleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: h.tealWash },
  scheduleChipText: { fontFamily: font.b, fontSize: 13, color: h.tealText },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeText: { fontFamily: font.sb, fontSize: 14, color: h.ivory, flex: 1 },
  pickupDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.teal, boxShadow: '0 0 0 3px rgba(14,143,163,0.16)' },
  dropDot: { width: 9, height: 9, borderRadius: 2.5, backgroundColor: h.ivory },
  backDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.surface, borderWidth: 2, borderColor: h.teal },
  backText: { fontFamily: font.m, fontSize: 13.5, color: h.muted, flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  addDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: h.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: h.teal, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px #FFFFFF' },
  addText: { flex: 1, fontFamily: font.b, fontSize: 14, color: h.tealText },
  addOptional: { fontFamily: font.sb, fontSize: 12.5, color: h.faint },
  tripFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingTop: 12, paddingBottom: 13, borderTopWidth: 1, borderTopColor: h.line07 },
  tripFootText: { flex: 1, fontFamily: font.m, fontSize: 12.5, color: h.muted, fontVariant: ['tabular-nums'] },

  askBlock: { marginTop: 24, marginBottom: 12, marginHorizontal: 2 },
  askTitle: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  askSub: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginTop: 3 },
  hourCard: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, borderRadius: 22, overflow: 'hidden', paddingBottom: 18, boxShadow: '0 2px 8px rgba(20,23,26,0.05), inset 0 1px 0 rgba(255,255,255,0.9)' },
  timeRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 6, paddingTop: 14, borderTopWidth: 1, borderTopColor: h.line07 },
  timeCol: { flex: 1, minWidth: 0 },
  timeDivider: { width: 1, backgroundColor: h.line08, marginHorizontal: 16 },
  timeLabel: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginBottom: 3 },
  timeValue: { fontFamily: font.b, fontSize: 14.5, color: h.ivory, fontVariant: ['tabular-nums'] },
  estimate: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14, marginHorizontal: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: h.tealWash },
  estimateWarn: { backgroundColor: '#FBF3E1' },
  estimateIcon: { marginTop: 1 },
  estimateText: { flex: 1, fontFamily: font.m, fontSize: 13, lineHeight: 19, color: '#0A5666' },

  knowCard: { marginTop: 14, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 8px rgba(20,23,26,0.05)' },
  knowHead: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  knowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  knowTitle: { flex: 1, fontFamily: font.b, fontSize: 14.5, color: h.ivory },
  knowBody: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 14 },
  knowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  knowCheck: { marginTop: 2 },
  knowText: { flex: 1, fontFamily: font.m, fontSize: 13.5, lineHeight: 20, color: '#3C4247' },

  footer: { paddingHorizontal: 18, paddingTop: 14, backgroundColor: h.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, boxShadow: '0 -10px 30px rgba(20,23,26,0.08)' },
})
