import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { Button, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import type { RatingTag } from '@ocar/mobile-shared'
import { fetchRatingTags, submitRating } from '@/features/safety/api'

const WORDS = ['', 'Poor', 'Below average', 'Okay', 'Good', 'Excellent']

// Rating lives on the summary itself: tap a star, tags appear below, submit. No navigation away.
export function RatingSection({ rideId, driverName, existing, onRated }: {
  rideId: string
  driverName: string
  existing: number | null
  onRated: () => void
}) {
  const [score, setScore] = useState(0)
  const [tags, setTags] = useState<RatingTag[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneScore, setDoneScore] = useState<number | null>(null)

  useEffect(() => {
    if (existing != null) return
    fetchRatingTags('user_to_driver').then(setTags).catch(() => {})
  }, [existing])

  const final = existing ?? doneScore
  const visibleTags = tags.filter((t) => (score >= 4 ? t.sentiment === 'positive' : score <= 2 ? t.sentiment === 'negative' : true))

  async function submit() {
    if (!score || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await submitRating({ rideId, direction: 'user_to_driver', score, tagIds: picked })
      setDoneScore(score)
      onRated()
    } catch {
      setError("Couldn't submit your rating. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (final != null) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{doneScore != null ? 'Thanks for rating!' : `You rated ${driverName}`}</Text>
        <Stars value={final} />
      </View>
    )
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>How was your ride with {driverName}?</Text>
      <Stars value={score} onSelect={setScore} />
      <Text style={styles.word}>{score > 0 ? WORDS[score] : 'Tap a star to rate'}</Text>

      {score > 0 && visibleTags.length > 0 ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.tagsWrap}>
          <Text style={styles.tagsLabel}>{score >= 4 ? 'What did you love?' : score <= 2 ? 'What went wrong?' : 'Tell us more'}</Text>
          <View style={styles.tags}>
            {visibleTags.map((t) => {
              const on = picked.includes(t.id)
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.tag, on && styles.tagOn]}
                >
                  <Text style={[styles.tagText, on && styles.tagTextOn]}>{t.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </Animated.View>
      ) : null}

      {score > 0 ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.submit}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={submitting ? 'Submitting…' : 'Submit rating'} onPress={() => void submit()} loading={submitting} />
        </Animated.View>
      ) : null}
    </View>
  )
}

function Stars({ value, onSelect }: { value: number; onSelect?: (n: number) => void }) {
  return (
    <View style={styles.stars} accessibilityRole={onSelect ? 'radiogroup' : 'image'} accessibilityLabel={onSelect ? undefined : `Rated ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((s) => {
        const on = value >= s
        const icon = <Ionicons name={on ? 'star' : 'star-outline'} size={38} color={on ? colors.accent : '#C3CCCE'} />
        return onSelect ? (
          <Pressable key={s} onPress={() => onSelect(s)} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected: value === s }} accessibilityLabel={`Rate ${s} of 5, ${WORDS[s]}`} style={styles.star}>
            {icon}
          </Pressable>
        ) : (
          <View key={s} style={styles.star}>{icon}</View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm + 2 },
  title: { ...typography.title, fontSize: 16, color: colors.ink900, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  word: { ...typography.label, fontSize: 14, color: colors.ink600 },
  tagsWrap: { alignSelf: 'stretch', gap: spacing.sm },
  tagsLabel: { ...typography.label, fontSize: 14, fontFamily: fonts.bold, color: colors.ink900 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tagOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { ...typography.label, fontSize: 14, color: colors.ink600, fontFamily: fonts.semibold },
  tagTextOn: { color: colors.inkInverse },
  submit: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.sm },
  error: { ...typography.label, color: colors.error, textAlign: 'center' },
})
