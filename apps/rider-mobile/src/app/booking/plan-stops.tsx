import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { LinearGradient } from 'expo-linear-gradient'
import { Button, Text, font, h } from '@ocar/mobile-shared'
import type { RentalPackage } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'
import { goBack } from '@/lib/goBack'
import { fetchRentalPackages, fetchVehicleCategories } from '@/features/booking/api'
import { MAX_STOPS } from '@/features/booking/constants'
import { formatDuration } from '@/features/booking/format'
import { useTripRoute } from '@/features/booking/hooks/useTripRoute'
import { recommendPackage } from '@/features/booking/recommendPackage'
import { RouteRail } from '@/features/booking/components/StopsList'
import { useBookingDraftStore } from '@/features/booking/store'

// Plan your stops (design: RentalStops.dc.html). The editor behind the rental route card's "Edit": the whole trip as
// one list, stops numbered, each movable one place later or removable. Uses the store's own removeStop / swapStop.
export default function PlanStopsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const pickup = useBookingDraftStore((s) => s.pickup)
  const drop = useBookingDraftStore((s) => s.drop)
  const stops = useBookingDraftStore((s) => s.stops)
  const originCityId = useBookingDraftStore((s) => s.originCityId)
  const removeStop = useBookingDraftStore((s) => s.removeStop)
  const swapStop = useBookingDraftStore((s) => s.swapStop)
  const { trip } = useTripRoute(pickup, drop, stops)
  const n = stops.length
  const full = n >= MAX_STOPS

  // "Best fit" follows the vehicle the rental screen opens by default (the sedan row, else the first), as that is what
  // the rider sees when they go back. Hidden when there are no packages or no route.
  const [packages, setPackages] = useState<RentalPackage[]>([])
  useEffect(() => {
    let cancelled = false
    fetchVehicleCategories()
      .then((cats) => {
        const cat = cats.find((c) => c.slug === 'sedan') ?? cats[0]
        return cat ? fetchRentalPackages(cat.id, originCityId) : []
      })
      .then((p) => { if (!cancelled) setPackages(p) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [originCityId])
  const best = useMemo(() => {
    const rec = trip ? recommendPackage(packages, trip.km, trip.min) : null
    return rec ? packages.find((p) => p.id === rec.packageId) ?? null : null
  }, [packages, trip])

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 150 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <IconButton icon="arrow-left" label="Go back" onPress={() => goBack(router)} />
          <View style={styles.headerText}>
            <Text style={styles.title}>Plan your stops</Text>
            <Text style={styles.subtitle}>Visited in the order shown</Text>
          </View>
          <View style={[styles.count, full ? styles.countFull : null]} accessibilityLabel={`${n} of ${MAX_STOPS} stops`}>
            <Text style={[styles.countText, full ? styles.countTextFull : null]}>{`${n} of ${MAX_STOPS}`}</Text>
          </View>
        </View>

        <View style={styles.strip}>
          <View>
            <Text style={styles.stripLabel}>Estimated trip</Text>
            <Text style={styles.stripValue}>{trip ? `${trip.km} km · ~${formatDuration(trip.min)}` : '...'}</Text>
          </View>
          {best ? (
            <View style={styles.bestPill}>
              <Text style={styles.bestLabel}>Best fit</Text>
              <LinearGradient colors={['#E5588A', '#C93566']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bestValue}>
                <Text style={styles.bestValueText}>{`${formatDuration(best.durationMinutes)} · ${best.kmLimit} km`}</Text>
              </LinearGradient>
            </View>
          ) : null}
        </View>

        <View style={styles.list}>
          <View style={styles.row}>
            <RouteRail line="down"><View style={styles.pickupDot} /></RouteRail>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Pickup</Text>
              <Text style={styles.rowName} numberOfLines={1}>{pickup?.address ?? 'Pickup location'}</Text>
            </View>
          </View>

          {stops.map((s, i) => (
            <View key={`${s.lat}-${s.lng}-${i}`} style={[styles.row, styles.rowBorder]}>
              <RouteRail line="full"><View style={styles.stopNum}><Text style={styles.stopNumText}>{i + 1}</Text></View></RouteRail>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{`Stop ${i + 1}`}</Text>
                <Text style={styles.rowName} numberOfLines={1}>{s.address}</Text>
              </View>
              {i < n - 1 ? (
                <Pressable onPress={() => swapStop(i)} accessibilityRole="button" accessibilityLabel="Move stop later" style={({ pressed }) => [styles.roundBtn, pressed ? styles.pressed : null]}>
                  <Feather name="arrow-down" size={16} color="#3C4247" />
                </Pressable>
              ) : null}
              <Pressable onPress={() => removeStop(i)} accessibilityRole="button" accessibilityLabel="Remove stop" style={({ pressed }) => [styles.roundBtn, pressed ? styles.pressed : null]}>
                <Feather name="x" size={16} color="#3C4247" />
              </Pressable>
            </View>
          ))}

          <View style={[styles.row, styles.rowBorder]}>
            <RouteRail line="up"><View style={styles.dropDot} /></RouteRail>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Drop</Text>
              <Text style={styles.rowName} numberOfLines={1}>{drop?.address ?? 'Destination'}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.hint}>
          {full ? `You have added the maximum of ${MAX_STOPS} stops. Remove one to add another.` : 'More stops add distance and time. The best fit package updates as you go.'}
        </Text>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) + 10 }]}>
        <Pressable
          onPress={() => router.push('/booking/add-stop')}
          disabled={full}
          accessibilityRole="button"
          accessibilityLabel="Add a stop"
          accessibilityState={{ disabled: full }}
          style={({ pressed }) => [styles.addBtn, full ? styles.addBtnOff : null, pressed ? styles.pressed : null]}
        >
          <Feather name="plus" size={16} color={full ? '#B6BBBE' : h.tealText} />
          <Text style={[styles.addText, full ? { color: '#B6BBBE' } : null]}>Add a stop</Text>
        </Pressable>
        <View style={styles.doneWrap}><Button variant="cta" label="Done" onPress={() => goBack(router)} /></View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  content: { paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.b, fontSize: 20, letterSpacing: -0.2, color: h.ivory },
  subtitle: { fontFamily: font.m, fontSize: 13, color: h.muted, marginTop: 1 },
  count: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: h.tealWash, justifyContent: 'center' },
  countFull: { backgroundColor: '#FBF1D9' },
  countText: { fontFamily: font.b, fontSize: 13, color: h.tealText, fontVariant: ['tabular-nums'] },
  countTextFull: { color: '#7A5410' },

  // wraps: on a narrow phone or with larger text the Best fit pill drops under the trip line instead of crowding it
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 10, marginTop: 20, marginBottom: 14, marginHorizontal: 2 },
  stripLabel: { fontFamily: font.m, fontSize: 12.5, color: h.label },
  stripValue: { fontFamily: font.b, fontSize: 15, color: h.ivory, marginTop: 2, fontVariant: ['tabular-nums'] },
  bestPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingLeft: 14, paddingRight: 6, borderRadius: 18, backgroundColor: h.roseWash, borderWidth: 1, borderColor: h.roseLine },
  bestLabel: { fontFamily: font.sb, fontSize: 12.5, color: '#7B5663' },
  bestValue: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center' },
  bestValueText: { fontFamily: font.xb, fontSize: 12.5, color: '#FFFFFF', fontVariant: ['tabular-nums'] },

  list: { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, borderRadius: 22, paddingVertical: 6, paddingHorizontal: 16, boxShadow: '0 2px 8px rgba(20,23,26,0.05), inset 0 1px 0 rgba(255,255,255,0.9)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingVertical: 4 },
  rowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(20,23,26,0.05)' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: font.sb, fontSize: 12, color: h.label },
  rowName: { fontFamily: font.sb, fontSize: 14.5, color: h.ivory, marginTop: 1 },
  pickupDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: h.teal, boxShadow: '0 0 0 4px rgba(14,143,163,0.16)' },
  dropDot: { width: 11, height: 11, borderRadius: 3, backgroundColor: h.ivory },
  stopNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FBF1D9', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px #FFFFFF' },
  stopNumText: { fontFamily: font.xb, fontSize: 12, color: '#7A5410', fontVariant: ['tabular-nums'] },
  roundBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4F5F1', alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.96 }] },
  hint: { fontFamily: font.m, fontSize: 13, lineHeight: 19, color: h.muted, marginTop: 14, marginHorizontal: 4 },

  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingHorizontal: 18, backgroundColor: h.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, boxShadow: '0 -10px 30px rgba(20,23,26,0.08)' },
  addBtn: { flex: 1, height: 56, borderRadius: 18, backgroundColor: h.surface, borderWidth: 1.5, borderColor: h.tealCta, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addBtnOff: { backgroundColor: '#F4F5F1', borderColor: h.line06 },
  addText: { fontFamily: font.b, fontSize: 15, color: h.tealText },
  doneWrap: { flex: 1.15 },
})
