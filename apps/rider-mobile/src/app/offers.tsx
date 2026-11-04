import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { ScreenHeader } from '@/features/profile/ScreenHeader'
import { fetchOffers, type OfferListItem } from '@/features/offers/api'
import { expiryText } from '@/features/offers/offerList'

// My Offers (design review D5): a plain list, not a gallery of banners. Code offers are never listed (a rider gets them
// by typing the code), so the empty state says where codes go instead of implying there are none.
export default function OffersScreen() {
  const insets = useSafeAreaInsets()
  const [offers, setOffers] = useState<OfferListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    setLoading(true)
    fetchOffers().then(setOffers).catch(() => setFailed(true)).finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  return (
    <View style={styles.container}>
      <ScreenHeader title="Offers" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : failed ? (
          <Pressable onPress={load} style={styles.retry} accessibilityRole="button" accessibilityLabel="Try loading offers again">
            <Text style={styles.retryText}>Couldn&apos;t load your offers. Tap to try again.</Text>
          </Pressable>
        ) : offers.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="tag" size={22} color={colors.ink400} />
            <Text style={styles.emptyTitle}>No offers right now</Text>
            <Text style={styles.emptyBody}>We&apos;ll let you know when there&apos;s one. Have a code? Enter it when you book.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {offers.map((o, i) => {
              const ends = expiryText(o.endsAt)
              return (
                <View key={o.id} style={[styles.row, i < offers.length - 1 ? styles.rowBorder : null]} accessible accessibilityLabel={`${o.name}. ${o.summary}${ends ? `. ${ends}` : ''}`}>
                  <View style={styles.icon}><Feather name="tag" size={16} color={colors.primary} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.name}>{o.name}</Text>
                    <Text style={styles.summary}>{o.summary}</Text>
                    {ends ? <Text style={styles.ends}>{ends}</Text> : null}
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, minHeight: 64 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  name: { ...typography.body, fontFamily: fonts.bold, color: colors.ink900 },
  summary: { ...typography.body, color: colors.ink600 },
  ends: { ...typography.caption, color: colors.ink600, marginTop: 2 },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing['2xl'] },
  emptyTitle: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  emptyBody: { ...typography.body, color: colors.ink600, textAlign: 'center', maxWidth: 280 },
  retry: { minHeight: 48, justifyContent: 'center' },
  retryText: { ...typography.body, color: colors.primaryDark, fontFamily: fonts.semibold },
})
