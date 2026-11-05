import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { ScreenHeader } from '@/features/profile/ScreenHeader'
import { fetchOffers, type OfferListItem } from '@/features/offers/api'
import { expiryText } from '@/features/offers/offerList'
import { OfferTicket } from '@/features/offers/OfferTicket'

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
            <View style={styles.emptyArt}>
              <View style={styles.emptyTicket}><Feather name="tag" size={26} color={colors.primaryDark} /></View>
              <View style={[styles.emptyNotch, { left: -7 }]} />
              <View style={[styles.emptyNotch, { right: -7 }]} />
            </View>
            <Text style={styles.emptyTitle}>No offers right now</Text>
            <Text style={styles.emptyBody}>We&apos;ll let you know when there&apos;s one. Have a code? Enter it when you book.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {offers.map((o) => {
              const ends = expiryText(o.endsAt)
              return (
                <OfferTicket
                  key={o.id} tone="available" notch={colors.bg} title={o.name} subtitle={o.summary}
                  saving={ends ?? undefined}
                  accessibilityLabel={`${o.name}. ${o.summary}${ends ? `. ${ends}` : ''}`}
                />
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
  list: { gap: spacing.sm },
  emptyArt: { width: 96, height: 64, marginBottom: spacing.sm },
  emptyTicket: { flex: 1, borderRadius: radii.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primaryLight, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  emptyNotch: { position: 'absolute', top: 26, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.primaryLight },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing['2xl'] },
  emptyTitle: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  emptyBody: { ...typography.body, color: colors.ink600, textAlign: 'center', maxWidth: 280 },
  retry: { minHeight: 48, justifyContent: 'center' },
  retryText: { ...typography.body, color: colors.primaryDark, fontFamily: fonts.semibold },
})
