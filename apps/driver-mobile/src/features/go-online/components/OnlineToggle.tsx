import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { colors } from '@ocar/mobile-shared'

export type OnlineToggleProps = {
  isOnline: boolean
  onToggle: () => void
  disabled?: boolean
}

// Direct port of apps/driver/src/components/ui/OnlineToggle.tsx -- the real web
// "go online" control is this 72px circular gradient power-button with an
// expanding pulse ring when online, never a plain OS Switch.
export function OnlineToggle({ isOnline, onToggle, disabled = false }: OnlineToggleProps) {
  const reduced = useReducedMotion()
  const active = isOnline && !reduced
  const t = useSharedValue(0)

  useEffect(() => {
    if (active) {
      t.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false))
    } else {
      cancelAnimation(t)
      t.set(0)
    }
  }, [active, t])

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + t.get() * 0.6 }],
    opacity: 0.55 * (1 - t.get()),
  }))

  return (
    <View style={styles.wrap}>
      {isOnline ? (
        <Animated.View pointerEvents="none" style={[styles.ring, ringStyle]} />
      ) : null}

      <Pressable
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={isOnline ? 'Go offline' : 'Go online'}
        accessibilityState={{ selected: isOnline, disabled }}
        style={({ pressed }) => [{ opacity: disabled ? 0.5 : 1 }, pressed ? styles.pressed : null]}
      >
        {isOnline ? (
          <LinearGradient
            colors={['#FB923C', '#F97316', '#EA580C']}
            start={{ x: 0.15, y: 0.1 }}
            end={{ x: 0.9, y: 1 }}
            style={[styles.button, styles.buttonOnlineShadow]}
          >
            <Feather name="power" size={18} color={colors.inkInverse} strokeWidth={2.5} />
            <Text style={[styles.label, styles.labelOnline]}>Online</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.button, styles.buttonOffline]}>
            <Feather name="power" size={18} color={colors.ink400} strokeWidth={2.5} />
            <Text style={[styles.label, styles.labelOffline]}>Offline</Text>
          </View>
        )}
      </Pressable>
    </View>
  )
}

const SIZE = 72

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: 'rgba(249,115,22,0.22)' },
  pressed: { transform: [{ scale: 0.97 }] },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', gap: 2 },
  buttonOnlineShadow: { shadowColor: '#F97316', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  buttonOffline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: colors.primary, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  label: { fontSize: 9, fontWeight: '700' },
  labelOnline: { color: colors.inkInverse },
  labelOffline: { color: colors.ink400 },
})
