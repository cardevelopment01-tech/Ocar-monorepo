import { memo } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Skeleton, VehicleIcon, font, h } from '@ocar/mobile-shared'
import type { VehicleCategory } from '@ocar/mobile-shared'
import { fleetImageFor } from '@/features/home/fleet'

// Text colour that stays readable on the mint wash (the brand's live green is too light for text on it).
export const RETURN_GREEN_INK = '#0E7A52'
const GREEN_INK = RETURN_GREEN_INK
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export type ReturnCabCardProps = {
  category: VehicleCategory
  /** The return-cab fare. */
  fare: number | null
  /** The standard fare for the same car and trip: the one real anchor the saving is measured against. */
  standardFare: number | null
  /** Minutes until the nearest return-cab driver could reach the pickup (absent when the server did not say). */
  etaMin: number | null
  loading: boolean
  selected: boolean
  onPress: () => void
}

/**
 * One return-cab row (design: the "Return cab" mock, option B). A saving is only ever claimed when the standard fare is really
 * higher: no strip and no percentage otherwise. The wait sits right next to the saving, so the trade is visible before booking.
 */
function ReturnCabCardBase({ category, fare, standardFare, etaMin, loading, selected, onPress }: ReturnCabCardProps) {
  const img = fleetImageFor(category.slug)
  const save = fare != null && standardFare != null && Math.round(standardFare) > Math.round(fare) ? Math.round(standardFare) - Math.round(fare) : 0
  const pct = save > 0 && standardFare != null ? Math.round((save / Math.round(standardFare)) * 100) : 0
  // Worded like the standard rows ("1 min away") so the two can be compared at a glance.
  const sub = etaMin != null ? `${etaMin} min away` : 'Heading your way'

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${category.displayName} return cab${fare != null ? `, ${Math.round(fare)} rupees` : ''}${save > 0 ? `, saves ${save} rupees, ${pct} percent off the standard fare` : ''}${etaMin != null ? `, about ${etaMin} minutes away` : ''}`}
      style={({ pressed }) => [s.card, selected ? s.cardOn : null, pressed ? s.pressed : null]}
    >
      {save > 0 ? (
        <View style={[s.strip, selected ? s.stripOn : null]}>
          <View style={s.stripLeft}>
            <Feather name="check" size={14} color={GREEN_INK} />
            <Text style={s.stripText}>Save {rupees(save)} on this trip</Text>
          </View>
          <Text style={s.stripPct}>{pct}% off</Text>
        </View>
      ) : null}
      <View style={s.body}>
        {/* collapsable={false}: keeps this wrapper a real view so Fabric never has to re-parent the image when the card's state changes. */}
        <View collapsable={false} style={s.imgBox}>
          {img ? <Image source={img} style={s.img} resizeMode="contain" accessibilityIgnoresInvertColors /> : <VehicleIcon slug={category.slug} size={44} />}
        </View>
        <View style={s.info}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>{category.displayName}</Text>
            <View style={s.pill}><Text style={s.pillText} numberOfLines={1}>Return cab</Text></View>
          </View>
          <Text style={s.sub} numberOfLines={1}>{sub}</Text>
        </View>
        <View style={s.fareBlock}>
          {loading ? (
            <Skeleton width={56} height={20} />
          ) : fare != null ? (
            <>
              {save > 0 && standardFare != null ? <Text style={s.old} accessibilityElementsHidden importantForAccessibility="no">{rupees(standardFare)}</Text> : null}
              <Text style={s.fare}>{rupees(fare)}</Text>
            </>
          ) : (
            <Text style={s.fareNone}>-</Text>
          )}
        </View>
      </View>
    </Pressable>
  )
}

const s = StyleSheet.create({
  card: { backgroundColor: h.surface, borderWidth: 1.5, borderColor: h.line08, borderRadius: 20, marginBottom: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(20,23,26,0.05)' },
  cardOn: { backgroundColor: '#F3FAFB', borderColor: h.tealCta, boxShadow: '0 0 0 4px rgba(14,143,163,0.12), 0 2px 8px rgba(20,23,26,0.06)' },
  pressed: { transform: [{ scale: 0.985 }] },
  strip: { height: 30, paddingHorizontal: 14, backgroundColor: '#EEF8F3', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stripOn: { backgroundColor: '#DDF5EA' },
  stripLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  stripText: { fontFamily: font.xb, fontSize: 12.5, color: GREEN_INK, fontVariant: ['tabular-nums'] },
  stripPct: { fontFamily: font.b, fontSize: 12, color: GREEN_INK, fontVariant: ['tabular-nums'] },
  body: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 8, paddingRight: 16, minHeight: 74 },
  imgBox: { width: 88, height: 56, alignItems: 'center', justifyContent: 'center' },
  img: { width: 88, height: 56 },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  name: { fontFamily: font.xb, fontSize: 16, color: h.ivory, flexShrink: 1 },
  pill: { backgroundColor: '#DDF5EA', borderRadius: 10, paddingHorizontal: 8, height: 20, justifyContent: 'center' },
  pillText: { fontFamily: font.b, fontSize: 11.5, color: GREEN_INK },
  sub: { fontFamily: font.sb, fontSize: 12.5, color: h.tealText },
  fareBlock: { minWidth: 56, alignItems: 'flex-end' },
  old: { fontFamily: font.sb, fontSize: 12.5, color: h.faint, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'], marginBottom: 1 },
  fare: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.4, color: h.ivory, fontVariant: ['tabular-nums'] },
  fareNone: { fontFamily: font.m, fontSize: 15, color: h.faint },
})

export const ReturnCabCard = memo(ReturnCabCardBase)
