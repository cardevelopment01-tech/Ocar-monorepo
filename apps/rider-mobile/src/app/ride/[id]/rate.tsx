import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Button, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchRide } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
import { fetchRatingTags, submitRating } from '@/features/safety/api'
import type { RatingTag } from '@ocar/mobile-shared'

// Native port of web's /ride/[id]/rate (apps/user/app/(main)/ride/[id]/rate/page.tsx):
// a dedicated post-ride screen rather than an inline sheet, matching web's own
// rider-side pattern (driver web uses an inline sheet on TripEnd instead -- that
// asymmetry is intentional, ported per-platform, not copied wholesale).
export default function RateRideScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const rideId = id ?? ''
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [ride, setRide] = useState<RideDetailExtra | null>(null)
  const [loading, setLoading] = useState(true)
  const [alreadyRated, setAlreadyRated] = useState(false)
  const [tags, setTags] = useState<RatingTag[]>([])
  const [rating, setRating] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!rideId) return
    fetchRide(rideId)
      .then((r) => {
        setRide(r)
        if (r.userRatingGiven != null) setAlreadyRated(true)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    fetchRatingTags('user_to_driver').then(setTags).catch(() => {})
  }, [rideId])

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]))
  }

  async function handleSubmit() {
    if (!rating || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await submitRating({ rideId, direction: 'user_to_driver', score: rating, tagIds: selectedTags })
      setSubmitted(true)
      setTimeout(() => router.replace('/(tabs)/home'), 1200)
    } catch {
      setError('Could not submit rating. Please try again.')
      setSubmitting(false)
    }
  }

  const fare = ride?.totalFinal ?? ride?.totalEstimated
  const filteredTags = tags.filter((t) => {
    if (rating >= 4) return t.sentiment === 'positive'
    if (rating > 0 && rating <= 2) return t.sentiment === 'negative'
    return true
  })

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
        <Skeleton height={100} style={{ marginBottom: spacing.md }} />
        <Skeleton height={48} />
      </View>
    )
  }

  if (submitted) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.celebrateEmoji}>🎉</Text>
        <Text style={styles.celebrateTitle}>Thanks for rating!</Text>
        <Text style={styles.celebrateBody}>Your feedback helps drivers improve</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      </View>
    )
  }

  if (alreadyRated) {
    return (
      <View style={[styles.container, styles.centered]}>
        <View style={styles.starBadge}>
          <Text style={styles.starBadgeEmoji}>⭐</Text>
        </View>
        <Text style={styles.celebrateTitle}>You already rated this trip</Text>
        <Text style={styles.celebrateBody}>Thanks for your feedback on this ride.</Text>
        <View style={{ marginTop: spacing.lg, width: '100%' }}>
          <Button label="Back to home" onPress={() => router.replace('/(tabs)/home')} />
        </View>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View style={styles.header}>
        {ride?.driverPhoto ? (
          <Image source={{ uri: ride.driverPhoto }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Feather name="user" size={26} color={colors.primary} />
          </View>
        )}
        <Text style={styles.title}>How was your ride?</Text>
        <Text style={styles.subtitle}>{ride?.driverName ?? 'Your driver'}</Text>
      </View>

      {(ride?.originAddress || ride?.destinationAddress || fare) ? (
        <View style={styles.tripCard}>
          <View style={{ flex: 1 }}>
            {ride?.originAddress ? <Text style={styles.tripAddress} numberOfLines={1}>{ride.originAddress}</Text> : null}
            {ride?.destinationAddress ? <Text style={styles.tripAddress} numberOfLines={1}>→ {ride.destinationAddress}</Text> : null}
          </View>
          {fare ? <Text style={styles.tripFare}>{`₹${Math.round(parseFloat(fare))}`}</Text> : null}
        </View>
      ) : null}

      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => setRating(star)} hitSlop={8}>
            <Feather
              name="star"
              size={36}
              color={rating >= star ? colors.warning : colors.border}
              style={rating >= star ? styles.starFilled : undefined}
            />
          </Pressable>
        ))}
      </View>

      {rating > 0 && filteredTags.length > 0 ? (
        <View style={styles.tagsSection}>
          <Text style={styles.tagsLabel}>{rating >= 4 ? 'What did you love?' : rating <= 2 ? 'What went wrong?' : 'Tell us more'}</Text>
          <View style={styles.tagsRow}>
            {filteredTags.map((tag) => {
              const active = selectedTags.includes(tag.id)
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => toggleTag(tag.id)}
                  style={[styles.tagChip, active ? styles.tagChipActive : null]}
                >
                  <Text style={[styles.tagText, active ? styles.tagTextActive : null]}>{tag.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button label={submitting ? 'Submitting…' : 'Submit rating'} onPress={() => void handleSubmit()} disabled={!rating} loading={submitting} />
        <Pressable onPress={() => router.replace('/(tabs)/home')} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: { alignItems: 'center', gap: 4 },
  photo: { width: 64, height: 64, borderRadius: 32, marginBottom: spacing.sm },
  photoFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800' },
  subtitle: { ...typography.body, color: colors.ink600 },
  tripCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  tripAddress: { ...typography.caption, color: colors.ink400 },
  tripFare: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
  starFilled: {},
  tagsSection: { gap: spacing.sm },
  tagsLabel: { ...typography.title, color: colors.ink900, fontWeight: '700' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tagChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { ...typography.label, color: colors.ink600, fontWeight: '600' },
  tagTextActive: { color: colors.inkInverse },
  error: { ...typography.body, color: colors.error, textAlign: 'center' },
  footer: { gap: spacing.sm, marginTop: 'auto' },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  skipText: { ...typography.body, color: colors.ink400 },
  starBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  starBadgeEmoji: { fontSize: 30 },
  celebrateEmoji: { fontSize: 56, marginBottom: spacing.md },
  celebrateTitle: { ...typography.headline, color: colors.ink900, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  celebrateBody: { ...typography.body, color: colors.ink400, textAlign: 'center' },
})
