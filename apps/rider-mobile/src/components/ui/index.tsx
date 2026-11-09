// Rider redesign primitives (docs/designs/ocar-redesign/DESIGN_BRIEF.md section 4). Rider-only on purpose:
// the driver app has its own redesign pass. Buttons live in @ocar/mobile-shared as Button variant 'cta' | 'soft'.
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Feather } from '@expo/vector-icons'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Press, Text, ease, font, h, shadow } from '@ocar/mobile-shared'

type IconName = React.ComponentProps<typeof Feather>['name']

/** 44px white circle, sm shadow. */
export function IconButton({ icon, onPress, label, color = h.ivory }: { icon: IconName; onPress?: () => void; label: string; color?: string }) {
  return (
    <Press onPress={onPress} scaleTo={0.94} label={label} style={s.iconBtn}>
      <Feather name={icon} size={20} color={color} />
    </Press>
  )
}

/** White r22 card of rows separated by a hairline inset 70px. */
export function GroupedList({ children, style }: { children: ReactNode[] | ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean)
  return (
    <View style={[s.group, style]}>
      {rows.map((c, i) => (
        <View key={i}>
          {i > 0 ? <View style={s.hairline} /> : null}
          {c}
        </View>
      ))}
    </View>
  )
}

export function ListRow({ icon, title, subtitle, onPress, right, danger }: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; right?: ReactNode; danger?: boolean }) {
  return (
    <Press onPress={onPress} scaleTo={0.985} label={title}>
      <View style={s.row}>
        <View style={s.rowIcon}><Feather name={icon} size={19} color={danger ? h.danger : h.ivory} /></View>
        <View style={s.rowText}>
          <Text style={[s.rowTitle, danger ? { color: h.danger } : null]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right ?? (onPress ? <Feather name="chevron-right" size={18} color={h.faint} /> : null)}
      </View>
    </Press>
  )
}

const CHIP = {
  teal: { bg: h.tealWash, fg: h.tealText },
  neutral: { bg: h.chip, fg: h.muted },
  gold: { bg: h.goldWash, fg: h.goldInk },
} as const
export function Chip({ label, tone = 'teal', icon }: { label: string; tone?: keyof typeof CHIP; icon?: IconName }) {
  const t = CHIP[tone]
  return (
    <View style={[s.chip, { backgroundColor: t.bg }]}>
      {icon ? <Feather name={icon} size={12} color={t.fg} /> : null}
      <Text style={[s.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  )
}

/** Header row that reveals `children` below (max-height reveal, chevron rotates 180deg, ease.sheet 450ms). */
export function ExpandableSection({ header, children, open: controlled, onToggle }: { header: ReactNode; children: ReactNode; open?: boolean; onToggle?: (open: boolean) => void }) {
  const [inner, setInner] = useState(false)
  const open = controlled ?? inner
  const [bodyH, setBodyH] = useState(0)
  const p = useSharedValue(open ? 1 : 0)
  p.set(withTiming(open ? 1 : 0, { duration: 450, easing: ease.sheet }))
  const body = useAnimatedStyle(() => ({ height: bodyH * p.get(), opacity: p.get(), overflow: 'hidden' }))
  const chev = useAnimatedStyle(() => ({ transform: [{ rotate: `${180 * p.get()}deg` }] }))
  const toggle = () => { setInner(!open); onToggle?.(!open) }
  return (
    <View>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={s.expHead}>
        <View style={{ flex: 1 }}>{header}</View>
        <Animated.View style={chev}><Feather name="chevron-down" size={20} color={h.muted} /></Animated.View>
      </Pressable>
      <Animated.View style={bodyH ? body : { height: 0, overflow: 'hidden' }}>
        {/* Measured off-screen-height wrapper: absolute so the animated height clips it, not squeezes it. */}
        <View style={{ position: 'absolute', left: 0, right: 0 }} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>{children}</View>
      </Animated.View>
    </View>
  )
}

/** Pickup (teal dot) -> dashed connector -> drop (ink square). `onAddStop` shows the dashed "Add stop" pill. */
export function RouteTimeline({ pickup, drop, stops = [], onAddStop }: { pickup: string; drop: string; stops?: string[]; onAddStop?: () => void }) {
  const items = [{ t: pickup, k: 'pickup' as const }, ...stops.map((t) => ({ t, k: 'stop' as const })), { t: drop, k: 'drop' as const }]
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={s.tlRow}>
          <View style={s.tlRail}>
            <View style={it.k === 'pickup' ? s.dotTeal : it.k === 'stop' ? s.dotGold : s.dotInk} />
            {i < items.length - 1 ? <View style={s.dash} /> : null}
          </View>
          <Text style={s.tlText} numberOfLines={1}>{it.t}</Text>
        </View>
      ))}
      {onAddStop ? (
        <Press onPress={onAddStop} scaleTo={0.97} label="Add stop" hit={{ alignSelf: 'flex-start', marginTop: 4 }} style={s.addStop}>
          <Feather name="plus" size={14} color={h.tealText} />
          <Text style={s.addStopText}>Add stop</Text>
        </Press>
      ) : null}
    </View>
  )
}

/** Coupon-applied banner: gold wash, gold border, dashed divider, then Remove. */
export function TicketBanner({ title, subtitle, onRemove }: { title: string; subtitle?: string; onRemove: () => void }) {
  return (
    <LinearGradient colors={['rgba(246,220,154,0.35)', 'rgba(214,165,82,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ticket}>
      <View style={s.ticketIcon}><Feather name="tag" size={17} color={h.goldInk} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.ticketTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={s.ticketDash} />
      <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove coupon"><Text style={s.ticketRemove}>Remove</Text></Pressable>
    </LinearGradient>
  )
}

/** label + grey detail on the left, tabular amount (width 64, right-aligned) on the right. */
export function ReceiptRow({ label, detail, amount, strong }: { label: string; detail?: string; amount: string; strong?: boolean }) {
  return (
    <View style={s.receipt}>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, strong ? { fontFamily: font.b } : null]}>{label}</Text>
        {detail ? <Text style={s.rowSub}>{detail}</Text> : null}
      </View>
      <Text style={[s.amount, strong ? { fontFamily: font.xb } : null]}>{amount}</Text>
    </View>
  )
}

/** 5 stars, 36px, gold fill; `onChange` makes it tappable. */
export function StarRating({ value, onChange, size = 36 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <View style={s.stars} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: value }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} disabled={!onChange} onPress={() => onChange?.(n)} hitSlop={4} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
          <Feather name="star" size={size} color={n <= value ? '#E2A93B' : '#E4EAEB'} style={n <= value ? s.starOn : null} />
        </Pressable>
      ))}
    </View>
  )
}

/** Track in chip bg (r14); the selected segment is tealCta with white text. */
export function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.segItem, on ? { backgroundColor: h.tealCta } : null]}>
            <Text style={[s.segText, { color: on ? '#fff' : h.muted }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: h.surface, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  group: { backgroundColor: h.surface, borderRadius: 22, boxShadow: shadow.sm, overflow: 'hidden' },
  hairline: { height: 1, backgroundColor: h.line06, marginLeft: 70 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: h.chip, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: font.sb, fontSize: 15, color: h.ivory },
  rowSub: { fontFamily: font.m, fontSize: 12.5, color: h.muted, marginTop: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: font.sb, fontSize: 12 },
  expHead: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 40 },
  tlRail: { width: 14, alignItems: 'center', alignSelf: 'stretch', paddingTop: 5 },
  dotTeal: { width: 12, height: 12, borderRadius: 6, backgroundColor: h.teal },
  dotGold: { width: 10, height: 10, borderRadius: 5, backgroundColor: h.gold },
  dotInk: { width: 11, height: 11, borderRadius: 2, backgroundColor: h.ivory },
  dash: { flex: 1, width: 0, marginTop: 4, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: h.line13 },
  tlText: { flex: 1, fontFamily: font.sb, fontSize: 14, color: h.ivory, paddingTop: 1 },
  addStop: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(14,143,163,0.4)' },
  addStopText: { fontFamily: font.sb, fontSize: 13, color: h.tealText },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, borderColor: h.gold, paddingHorizontal: 14, paddingVertical: 12 },
  ticketIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: h.goldWash, alignItems: 'center', justifyContent: 'center' },
  ticketTitle: { fontFamily: font.b, fontSize: 14, color: h.ivory },
  ticketDash: { alignSelf: 'stretch', borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: h.gold },
  ticketRemove: { fontFamily: font.sb, fontSize: 13, color: h.tealText },
  receipt: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  amount: { width: 64, textAlign: 'right', fontFamily: font.b, fontSize: 14.5, color: h.ivory, fontVariant: ['tabular-nums'] },
  stars: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  starOn: { },
  seg: { flexDirection: 'row', backgroundColor: h.chip, borderRadius: 14, padding: 4, gap: 4 },
  segItem: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segText: { fontFamily: font.sb, fontSize: 13.5 },
})
