import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { Button, Skeleton, colors, radii, spacing, typography, fonts } from '@ocar/mobile-shared'
import { fetchRide } from '@/features/ride-tracking/api'
import type { RideDetailExtra } from '@/features/ride-tracking/types'
import { fetchRatingTags, submitRating } from '@/features/safety/api'
import type { RatingTag } from '@ocar/mobile-shared'

// Native port of web's /ride/[id]/rate (apps/user/app/(main)/ride/[id]/rate/page.tsx):
// a dedicated post-ride screen rather than an inline sheet, matching web's own
// rider-side pattern (driver web uses an inline sheet on TripEnd instead -- that
// asymmetry is intentional, ported per-platform, not copied wholesale).
const RATING_WORDS = ['', 'Poor', 'Below average', 'Okay', 'Good', 'Excellent']

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
        <View style={styles.starBadge}>
          <Feather name="check" size={30} color={colors.primary} />
        </View>
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
          <Ionicons name="star" size={30} color={colors.accent} />
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
          <View style={{ flex: 1, gap: 8 }}>
            {ride?.originAddress ? (
              <View style={styles.tripRow}>
                <View style={styles.dotFrom} />
                <Text style={styles.tripAddress} numberOfLines={1}>{ride.originAddress}</Text>
              </View>
            ) : null}
            {ride?.destinationAddress ? (
              <View style={styles.tripRow}>
                <View style={styles.dotTo} />
                <Text style={styles.tripAddress} numberOfLines={1}>{ride.destinationAddress}</Text>
              </View>
            ) : null}
          </View>
          {fare ? <Text style={styles.tripFare}>{`₹${Math.round(parseFloat(fare))}`}</Text> : null}
        </View>
      ) : null}

      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => setRating(star)} hitSlop={8}>
            <Ionicons name={rating >= star ? 'star' : 'star-outline'} size={40} color={rating >= star ? colors.accent : '#C9D1D3'} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.ratingWord}>{rating > 0 ? RATING_WORDS[rating] : 'Tap a star to rate'}</Text>

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
  photo: { width: 84, height: 84, borderRadius: 42, marginBottom: spacing.sm, borderWidth: 3, borderColor: colors.surface },
  photoFallback: { backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, color: colors.ink900, fontFamily: fonts.bold },
  subtitle: { ...typography.body, color: colors.ink600 },
  tripCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tripAddress: { ...typography.caption, color: colors.ink600, flex: 1 },
  dotFrom: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.primary },
  dotTo: { width: 9, height: 9, borderRadius: 2, backgroundColor: colors.ink900 },
  ratingWord: { ...typography.title, color: colors.ink900, textAlign: 'center', fontFamily: fonts.bold, marginTop: -spacing.xs },
  tripFare: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm + 2 },
  starFilled: {},
  tagsSection: { gap: spacing.sm },
  tagsLabel: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tagChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tagChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { ...typography.label, color: colors.ink600, fontFamily: fonts.semibold },
  tagTextActive: { color: colors.inkInverse },
  error: { ...typography.body, color: colors.error, textAlign: 'center' },
  footer: { gap: spacing.sm, marginTop: 'auto' },
  skipBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  skipText: { ...typography.body, color: colors.ink400 },
  starBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  starBadgeEmoji: { fontSize: 30 },
  celebrateEmoji: { fontSize: 56, marginBottom: spacing.md },
  celebrateTitle: { ...typography.headline, color: colors.ink900, fontFamily: fonts.bold, textAlign: 'center', marginBottom: 4 },
  celebrateBody: { ...typography.body, color: colors.ink400, textAlign: 'center' },
})
