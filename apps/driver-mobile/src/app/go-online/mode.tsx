import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'

export default function ModeSelectionScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink600} />
        </Pressable>
        <Text style={styles.title}>How do you want to drive?</Text>
      </View>

      <View style={styles.content}>
        <Animated.View entering={FadeInDown.duration(360).delay(0)}>
          <Pressable onPress={() => router.push('/go-online/standard')} style={styles.card}>
            <View style={[styles.iconTile, { backgroundColor: '#0F172A' }]}>
              <Feather name="truck" size={24} color={colors.inkInverse} />
            </View>
            <View style={styles.cardBodyWrap}>
              <Text style={styles.cardTitle}>Standard Mode</Text>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Operational</Text>
              </View>
              <Text style={styles.cardBody}>Accept rides anywhere in the city.</Text>
              <View style={styles.tagRow}>
                <View style={styles.tag}><Text style={styles.tagText}>All areas</Text></View>
                <View style={styles.tag}><Text style={styles.tagText}>No restriction</Text></View>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={colors.ink900} style={styles.chevron} />
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(360).delay(80)}>
          <Pressable onPress={() => router.push('/go-online/return-cab')} style={styles.card}>
            <View style={[styles.iconTile, { backgroundColor: colors.success }]}>
              <Feather name="corner-up-left" size={24} color={colors.inkInverse} />
            </View>
            <View style={styles.cardBodyWrap}>
              <Text style={styles.cardTitle}>Return Cab</Text>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Active</Text>
              </View>
              <Text style={styles.cardBody}>Set a destination and only accept rides heading that way.</Text>
              <View style={styles.tagRow}>
                <View style={[styles.tag, styles.tagGreen]}><Text style={[styles.tagText, styles.tagTextGreen]}>One-way</Text></View>
                <View style={[styles.tag, styles.tagGreen]}><Text style={[styles.tagText, styles.tagTextGreen]}>Earn on the way</Text></View>
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={colors.success} style={styles.chevron} />
          </Pressable>
        </Animated.View>

        <Text style={styles.footerNote}>You can go offline at any time from the home screen</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  backBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800', flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radii['2xl'], padding: spacing.lg, borderWidth: 1, borderColor: colors.border, position: 'relative' },
  iconTile: { width: 56, height: 56, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  // Room for the chevron, which is absolutely centered to the whole card
  // (below) rather than laid out as a row sibling -- a flex sibling can only
  // ever land at ITS OWN cross-axis position, which is what put the arrow at
  // the tags' height instead of centered against the icon/title.
  cardBodyWrap: { flex: 1, paddingRight: spacing.lg + 2 },
  // Own line below the title, not squeezed onto it -- "Standard Mode" plus
  // an inline "OPERATIONAL" badge left them touching with zero breathing
  // room (space-between only has the row's leftover width to distribute,
  // and a long title + badge leaves almost none). A status label doesn't
  // need to fight the heading for the same line.
  cardTitle: { ...typography.title, color: colors.ink900, fontWeight: '800', marginBottom: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  statusText: { fontSize: 9, fontWeight: '700', color: colors.ink400, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardBody: { ...typography.body, color: colors.ink600, marginBottom: spacing.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radii.full, backgroundColor: colors.surface3 },
  tagText: { fontSize: 11, fontWeight: '700', color: colors.ink600 },
  tagGreen: { backgroundColor: colors.successLight },
  tagTextGreen: { color: colors.success },
  chevron: { position: 'absolute', right: spacing.lg, top: '50%', marginTop: -9 },
  footerNote: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginTop: spacing.md },
})
