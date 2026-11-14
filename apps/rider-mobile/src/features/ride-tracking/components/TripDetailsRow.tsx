import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { font, h } from '@ocar/mobile-shared'

type IconName = React.ComponentProps<typeof Feather>['name']

export type DetailsAction = { key: string; label: string; icon: IconName; onPress: () => void }

// The mockup's "Trip details" row: one line with a hint of what is inside ("Add stop, cancel") and a chevron that
// turns over when it opens. The panel below holds the actions, the route and fare, and the Cancel ride card, so the
// bottom of the sheet stays calm instead of showing five cramped tiles.
export function TripDetailsRow({
  open, onToggle, hint, actions, children, cancel,
}: {
  open: boolean
  onToggle: () => void
  hint: string
  actions: DetailsAction[]
  children: ReactNode
  /** The Cancel ride card; null when the ride can no longer be cancelled. */
  cancel: { note: string; onPress: () => void } | null
}) {
  const reduced = useReducedMotion()
  const chev = useAnimatedStyle(() => ({ transform: [{ rotate: reduced ? (open ? '180deg' : '0deg') : withTiming(open ? '180deg' : '0deg', { duration: 300 }) }] }), [open, reduced])
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Trip details. ${hint}`}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      >
        <Feather name="list" size={18} color={h.ivory} />
        <Text style={styles.title}>Trip details</Text>
        <Text style={styles.hint} numberOfLines={1}>{hint}</Text>
        <Animated.View style={chev}><Feather name="chevron-down" size={18} color={h.faint} /></Animated.View>
      </Pressable>

      {open ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} layout={LinearTransition.duration(220)} style={styles.panel}>
          {actions.length > 0 ? (
            <View style={styles.actions}>
              {actions.map((a, i) => (
                <Pressable
                  key={a.key}
                  onPress={a.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                  style={({ pressed }) => [styles.action, i === 0 ? styles.actionPrimary : null, pressed ? styles.pressed : null]}
                >
                  <Feather name={a.icon} size={18} color={i === 0 ? h.tealText : h.ivory} />
                  <Text style={[styles.actionText, i === 0 ? { color: h.tealText } : null]} numberOfLines={1}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {children}

          {cancel ? (
            <View style={styles.cancelCard}>
              <View style={styles.cancelText}>
                <Text style={styles.cancelTitle}>Cancel ride</Text>
                <Text style={styles.cancelNote}>{cancel.note}</Text>
              </View>
              <Pressable onPress={cancel.onPress} accessibilityRole="button" accessibilityLabel="Cancel ride" style={({ pressed }) => [styles.cancelBtn, pressed ? styles.pressed : null]}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 6 },
  rowPressed: { opacity: 0.7 },
  title: { fontFamily: font.b, fontSize: 14.5, color: h.ivory },
  hint: { flex: 1, textAlign: 'right', fontFamily: font.sb, fontSize: 12.5, color: h.tealText },
  panel: { gap: 12, paddingTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: { flexGrow: 1, flexBasis: '45%', minHeight: 54, borderRadius: 16, backgroundColor: h.chip, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  actionPrimary: { backgroundColor: h.tealWash },
  actionText: { fontFamily: font.b, fontSize: 14, color: h.ivory, flexShrink: 1 },
  pressed: { transform: [{ scale: 0.97 }] },
  cancelCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(194,59,59,0.22)', backgroundColor: '#FFFAFA', paddingVertical: 14, paddingHorizontal: 16 },
  cancelText: { flex: 1, minWidth: 0 },
  cancelTitle: { fontFamily: font.b, fontSize: 14.5, color: h.danger, marginBottom: 2 },
  cancelNote: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted },
  cancelBtn: { height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: h.surface, borderWidth: 1.5, borderColor: 'rgba(194,59,59,0.4)', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontFamily: font.b, fontSize: 13.5, color: h.danger },
})
