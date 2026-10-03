import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, h, shadow, spacing, typography, Text } from '@ocar/mobile-shared'
import { GlassChip, ModeHero, type HeroKind } from '@/features/go-online/components/ModeHero'

type Mode = {
  key: HeroKind
  href: '/go-online/standard' | '/go-online/return-cab'
  chipIcon: keyof typeof Feather.glyphMap
  chip: string
  title: string
  body: string
}

const MODES: Mode[] = [
  { key: 'standard', href: '/go-online/standard', chipIcon: 'map-pin', chip: 'Anywhere in the city', title: 'Standard', body: 'Take any ride that comes your way.' },
  { key: 'return', href: '/go-online/return-cab', chipIcon: 'corner-up-left', chip: 'Heading somewhere', title: 'Return cab', body: 'Pick a destination and only get rides on the way.' },
]

export default function ModeSelectionScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={4}>
          <Feather name="arrow-left" size={20} color={colors.ink900} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">How do you want to drive?</Text>
        <Text style={styles.subtitle}>You can switch from Home any time.</Text>
      </View>

      <View style={styles.content}>
        {MODES.map((m, i) => (
          <Animated.View key={m.key} entering={FadeInDown.duration(340).delay(i * 80)}>
            <Pressable
              onPress={() => router.push(m.href)}
              accessibilityRole="button"
              accessibilityLabel={`${m.title}. ${m.body}`}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <ModeHero kind={m.key} height={212}>
                <View style={styles.heroTop}>
                  <GlassChip icon={m.chipIcon} label={m.chip} />
                </View>
                <View style={styles.heroBottom}>
                  <View style={styles.heroText}>
                    <Text style={styles.heroTitle}>{m.title}</Text>
                    <Text style={styles.heroBody}>{m.body}</Text>
                  </View>
                  <View style={styles.go}>
                    <Feather name="arrow-right" size={20} color={colors.inkInverse} />
                  </View>
                </View>
              </ModeHero>
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  // Same round white control as Home's wallet and bell pills.
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: h.line08, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, boxShadow: shadow.sm },
  title: { ...typography.display, color: colors.ink900 },
  subtitle: { ...typography.body, color: colors.ink600 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
  heroTop: { position: 'absolute', top: spacing.md + 2, left: spacing.md + 2 },
  heroBottom: { position: 'absolute', left: spacing.md + 2, right: spacing.md + 2, bottom: spacing.md + 2, flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  heroText: { flex: 1, minWidth: 0, gap: 2 },
  heroTitle: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.4, color: colors.inkInverse },
  heroBody: { ...typography.label, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.88)' },
  go: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
})
