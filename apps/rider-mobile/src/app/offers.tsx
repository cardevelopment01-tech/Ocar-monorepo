import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Text, font, h } from '@ocar/mobile-shared'
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {loading ? (
          <ActivityIndicator color={h.teal} style={{ marginTop: 24 }} />
        ) : failed ? (
          <Pressable onPress={load} style={styles.retry} accessibilityRole="button" accessibilityLabel="Try loading offers again">
            <Text style={styles.retryText}>Couldn&apos;t load your offers. Tap to try again.</Text>
          </Pressable>
        ) : offers.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyArt}>
              <View style={styles.emptyTicket}><Feather name="tag" size={26} color="#8A5F12" /></View>
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
                  key={o.id} tone="available" notch={h.canvas} title={o.name} subtitle={o.summary}
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
  container: { flex: 1, backgroundColor: h.canvas },
  content: { padding: 18, gap: 16 },
  list: { gap: 12 },
  emptyArt: { width: 104, height: 68, marginBottom: 12 },
  emptyTicket: { flex: 1, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(214,165,82,0.6)', backgroundColor: '#FBF3E1', alignItems: 'center', justifyContent: 'center' },
  emptyNotch: { position: 'absolute', top: 27, width: 14, height: 14, borderRadius: 7, backgroundColor: h.canvas, borderWidth: 1.5, borderColor: 'rgba(214,165,82,0.6)' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 48 },
  emptyTitle: { fontFamily: font.xb, fontSize: 20, letterSpacing: -0.3, color: h.ivory },
  emptyBody: { fontFamily: font.m, fontSize: 14, lineHeight: 20, color: h.muted, textAlign: 'center', maxWidth: 280 },
  retry: { minHeight: 48, justifyContent: 'center' },
  retryText: { fontFamily: font.sb, fontSize: 14.5, color: h.tealText },
})
