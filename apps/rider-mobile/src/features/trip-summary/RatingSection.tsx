import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { Button, font, h, getApiErrorMessage } from '@ocar/mobile-shared'
import type { RatingTag } from '@ocar/mobile-shared'
import { fetchRatingTags, submitRating } from '@/features/safety/api'

// Unselected star: darker than colors.border so it reads on white.
const EMPTY_STAR = '#E4EAEB'
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
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't submit your rating. Please try again."))
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
      <Text style={styles.title}>How was your ride?</Text>
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
          <Button variant="cta" label={submitting ? 'Submitting…' : 'Submit rating'} onPress={() => void submit()} loading={submitting} />
        </Animated.View>
      ) : null}
    </View>
  )
}

// A star pops (up, then settles) when it turns on, a little later for each one further along, so a 5 fills like a sweep.
function StarIcon({ on, index }: { on: boolean; index: number }) {
  const k = useSharedValue(1)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (on) k.set(withSequence(withTiming(1, { duration: index * 55 }), withTiming(1.28, { duration: 110 }), withSpring(1, { damping: 12 })))
    else k.set(1)
  }, [on, index, k])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: k.get() }] }))
  return (
    <Animated.View style={style}>
      <Ionicons name="star" size={36} color={on ? '#E2A93B' : EMPTY_STAR} />
    </Animated.View>
  )
}

function Stars({ value, onSelect }: { value: number; onSelect?: (n: number) => void }) {
  return (
    <View style={styles.stars} accessibilityRole={onSelect ? 'radiogroup' : 'image'} accessibilityLabel={onSelect ? undefined : `Rated ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((s) => {
        const on = value >= s
        const icon = <StarIcon on={on} index={s - 1} />
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
  wrap: { alignItems: 'center', gap: 12 },
  title: { fontFamily: font.b, fontSize: 17, color: h.ivory, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  word: { fontFamily: font.sb, fontSize: 14, color: h.muted },
  tagsWrap: { alignSelf: 'stretch', gap: 10 },
  tagsLabel: { fontFamily: font.sb, fontSize: 14, color: h.ivory },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: h.line10, backgroundColor: h.chip },
  tagOn: { backgroundColor: h.tealCta, borderColor: h.tealCta },
  tagText: { fontFamily: font.sb, fontSize: 13.5, color: h.ivory },
  tagTextOn: { color: '#FFFFFF' },
  submit: { alignSelf: 'stretch', gap: 8, marginTop: 8 },
  error: { fontFamily: font.m, fontSize: 13, color: h.danger, textAlign: 'center' },
})
