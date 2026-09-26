import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/features/home/Text'
import { LinearGradient } from 'expo-linear-gradient'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
import { font, geo, h, shadow } from '@/theme/homeTokens'
import { useBookingDraftStore } from '@/features/booking/store'
import { BackIcon, ShieldCheckIcon } from '@/features/home/icons'
import { Press } from '@/features/home/Press'

const T = h.teal
const G = h.gold
const bulletIcon = (children: ReactNode) => (
  <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    {children}
  </Svg>
)

type Info = {
  title: string
  eyebrow: string
  headline: string
  desc: string
  cta: string
  bullets: { icon: ReactNode; bold: string; rest: string; gold?: boolean }[]
}

// Copy and icons from the reference's Trip Safety / Golden Triangle screens.
const INFO: Record<string, Info> = {
  safety: {
    title: 'Trip Safety',
    eyebrow: 'Built into every trip',
    headline: 'Your safety, chauffeured',
    desc: 'Outstation trips mean hours on the road together. Ocar keeps someone watching the whole way, without you having to ask.',
    cta: 'Plan a safer trip',
    bullets: [
      { icon: bulletIcon(<Path d="M8 1.5L13.5 4V7.5C13.5 10.8 11.2 13.7 8 14.5C4.8 13.7 2.5 10.8 2.5 7.5V4L8 1.5Z" stroke={T} strokeWidth={1.3} />), bold: 'Every chauffeur verified', rest: '. ID-checked and background-verified before their first trip.' },
      { icon: bulletIcon(<><Circle cx={8} cy={8} r={6} stroke={T} strokeWidth={1.3} /><Circle cx={8} cy={8} r={1.6} fill={T} /></>), bold: 'Live location, shared', rest: '. Send your trip to anyone you choose, updated the whole ride.' },
      { icon: bulletIcon(<><Path d="M8 1.5V9M8 12V13.2" stroke={T} strokeWidth={1.5} strokeLinecap="round" /><Circle cx={8} cy={8} r={6.5} stroke={T} strokeWidth={1.3} /></>), bold: 'One-tap SOS', rest: '. Connects you straight to our safety desk, 24 hours a day.' },
    ],
  },
  'golden-triangle': {
    title: 'Puri – Konark Day Trip',
    eyebrow: 'Odisha, at your pace',
    headline: 'The Golden Triangle, one chauffeur',
    desc: "Bhubaneswar's temples, the Sun Temple at Konark, and Jagannath Temple in Puri, in one day with one car and no return-leg surcharge.",
    cta: 'Plan this trip',
    bullets: [
      { gold: true, icon: bulletIcon(<Path d="M8 1.5L9.5 5.5H13.5L10.2 8L11.5 12L8 9.7L4.5 12L5.8 8L2.5 5.5H6.5L8 1.5Z" stroke={G} strokeWidth={1.2} strokeLinejoin="round" />), bold: 'Bhubaneswar to Konark to Puri', rest: '. A curated route through all three, in either order.' },
      { icon: bulletIcon(<Path d="M2 8H14M2 8L5 5M2 8L5 11" stroke={T} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />), bold: 'Unlimited stops, all day', rest: '. One chauffeur waits at every temple, no re-booking.' },
      { icon: bulletIcon(<><Rect x={2.5} y={3} width={11} height={10} rx={1.5} stroke={T} strokeWidth={1.3} /><Path d="M2.5 6.5H13.5" stroke={T} strokeWidth={1.3} /></>), bold: 'Flexible start time', rest: '. Leave early for sunrise at Konark, or after breakfast.' },
    ],
  },
}

// radial-gradient(circle at x y, color, transparent 55%) -> 55% of the farthest-corner radius
const Glow = ({ cx, cy, r, color, id }: { cx: number; cy: number; r: number; color: string; id: string }) => (
  <>
    <Defs>
      <RadialGradient id={id} cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
        <Stop offset={0} stopColor={color} stopOpacity={0.24} />
        <Stop offset={1} stopColor={color} stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Rect x={0} y={0} width={354} height={168} fill={`url(#${id})`} />
  </>
)

function Hero({ slug }: { slug: string }) {
  const safety = slug === 'safety'
  return (
    <View style={styles.hero}>
      <LinearGradient colors={safety ? ['#EAF7F8', '#FFFFFF'] : ['#FBF3E6', '#FFFFFF']} locations={[0, 0.7]} start={{ x: 0.33, y: -0.05 }} end={{ x: 0.67, y: 1.05 }} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 354 168" preserveAspectRatio="none">
        {safety ? (
          <Glow id="g1" cx={106} cy={34} r={155} color={T} />
        ) : (
          <>
            <Glow id="g2" cx={266} cy={25} r={150} color={G} />
            <Glow id="g3" cx={71} cy={143} r={150} color={T} />
          </>
        )}
      </Svg>
      {safety ? (
        <ShieldCheckIcon size={72} color={T} w={1.3} />
      ) : (
        <View style={styles.track}>
          {[
            { at: 0, label: 'Bhubaneswar', color: T },
            { at: 0.5, label: 'Konark', color: G },
            { at: 1, label: 'Puri', color: T },
          ].map((s) => (
            <View key={s.label} style={[styles.stopAnchor, { left: `${s.at * 100}%` }]}>
              <View style={[styles.stop, { backgroundColor: s.color }]} />
              <Text style={styles.stopLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

export default function InfoScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const setRideType = useBookingDraftStore((s) => s.setRideType)
  const info = slug ? INFO[slug] : undefined
  if (!slug || !info) return <Redirect href="/home" />

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Press onPress={() => router.back()} scaleTo={0.88} label="Back" style={styles.back}>
          <BackIcon />
        </Press>
        <Text style={styles.title}>{info.title}</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.body, { paddingBottom: 120 + insets.bottom }]}>
        <Hero slug={slug} />
        <Text style={styles.eyebrow}>{info.eyebrow}</Text>
        <Text style={styles.headline}>{info.headline}</Text>
        <Text style={styles.desc}>{info.desc}</Text>
        <View style={styles.bullets}>
          {info.bullets.map((b, i) => (
            <View key={b.bold} style={[styles.bullet, i < info.bullets.length - 1 && styles.bulletDivider]}>
              <View style={[styles.bulletIcon, b.gold && { backgroundColor: 'rgba(214,165,82,0.14)' }]}>{b.icon}</View>
              <Text style={styles.bulletText}>
                <Text style={styles.bulletBold}>{b.bold}</Text>
                {b.rest}
              </Text>
            </View>
          ))}
        </View>
        <Press
          onPress={() => {
            setRideType('one_way', false)
            router.replace('/booking')
          }}
          scaleTo={0.98}
          label={info.cta}
          style={styles.cta}
        >
          <Text style={styles.ctaText}>{info.cta}</Text>
        </Press>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 20, paddingHorizontal: geo.gutter, paddingBottom: 10 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  title: { fontFamily: font.sb, fontSize: 18, color: h.ivory },
  body: { paddingTop: 8, paddingHorizontal: geo.gutter },
  hero: { height: 168, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(20,23,26,0.05)', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  track: { width: '78%', height: 2, backgroundColor: 'rgba(20,23,26,0.14)' },
  stopAnchor: { position: 'absolute', top: 1, width: 0, height: 0, alignItems: 'center' },
  stop: { position: 'absolute', top: -5, width: 10, height: 10, borderRadius: 5, boxShadow: '0 0 0 3px #FFFFFF' },
  stopLabel: { position: 'absolute', top: 15, width: 90, textAlign: 'center', fontFamily: font.r, fontSize: 9.5, color: h.ivoryDim },
  eyebrow: { fontFamily: font.sb, fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', color: T, marginBottom: 8 },
  headline: { fontFamily: font.b, fontSize: 22, lineHeight: 27.5, color: h.ivory, marginBottom: 10 },
  desc: { fontFamily: font.r, fontSize: 13, lineHeight: 20.8, color: h.ivoryDim, marginBottom: 20 },
  bullets: { marginBottom: 24 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14 },
  bulletDivider: { borderBottomWidth: 1, borderBottomColor: h.line07 },
  bulletIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(14,143,163,0.12)', alignItems: 'center', justifyContent: 'center' },
  bulletText: { flex: 1, fontFamily: font.r, fontSize: 13, lineHeight: 19.5, color: h.ivory, paddingTop: 6 },
  bulletBold: { fontFamily: font.sb },
  cta: { backgroundColor: T, borderRadius: 16, padding: 16, alignItems: 'center', boxShadow: '0 10px 24px rgba(14,143,163,0.28)' },
  ctaText: { fontFamily: font.b, fontSize: 14.5, color: '#FFFFFF' },
})
