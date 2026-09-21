import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import axios from 'axios'
import { Button, colors, radii, spacing, typography, type RatingTag } from '@ocar/mobile-shared'
import { fetchRiderTags, rateRider } from '../safety-api'

export type RateRiderSheetProps = {
  visible: boolean
  rideId: string
  riderName?: string | null
  onClose: () => void
}

// Native port of web's TripEnd.tsx rating sheet (apps/driver/src/pages/ActiveRide/TripEnd.tsx)
// -- an inline bottom sheet over the trip-completion screen, not a separate route
// (that asymmetry vs. rider-mobile's dedicated /rate screen matches each platform's
// own web behaviour). Same simplistic posture as web: no "already rated" check --
// the sheet just shows once per landing on the completed screen.
export function RateRiderSheet({ visible, rideId, riderName, onClose }: RateRiderSheetProps) {
  const insets = useSafeAreaInsets()
  const [tags, setTags] = useState<RatingTag[]>([])
  const [rating, setRating] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (visible) fetchRiderTags().then(setTags).catch(() => {})
  }, [visible])

  function toggleTag(id: string) {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  async function handleSubmit() {
    if (!rating || submitting) return
    setSubmitting(true)
    setError(false)
    try {
      await rateRider(rideId, rating, selectedTags)
      setSubmitted(true)
      setTimeout(onClose, 700)
    } catch (err) {
      const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
      if (code === 'RATING_ALREADY_EXISTS') {
        setSubmitted(true)
        setTimeout(onClose, 700)
      } else {
        setError(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const filteredTags = tags.filter((t) => {
    if (rating >= 4) return t.sentiment === 'positive'
    if (rating > 0 && rating <= 2) return t.sentiment === 'negative'
    return true
  })

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />

        {submitted ? (
          <View style={styles.submittedRow}>
            <Feather name="check" size={16} color={colors.primary} />
            <Text style={styles.submittedText}>Thanks for rating your rider</Text>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>Rate {riderName ?? 'your rider'}</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Skip rating">
                <Feather name="x" size={20} color={colors.ink400} />
              </Pressable>
            </View>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => setRating(star)} hitSlop={8}>
                  <Feather name="star" size={34} color={rating >= star ? colors.warning : colors.border} />
                </Pressable>
              ))}
            </View>

            {rating > 0 && filteredTags.length > 0 ? (
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
            ) : null}

            {rating > 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Button label={submitting ? 'Submitting…' : 'Submit rating'} onPress={() => void handleSubmit()} loading={submitting} />
              </View>
            ) : null}
            {error ? <Text style={styles.error}>Could not submit, try again.</Text> : null}
          </>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(15,23,42,0.5)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, gap: spacing.sm },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginVertical: spacing.md },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center', marginBottom: spacing.xs },
  tagChip: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 2, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  tagChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { ...typography.caption, color: colors.ink600, fontWeight: '600' },
  tagTextActive: { color: colors.inkInverse },
  submittedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  submittedText: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  error: { ...typography.caption, color: colors.error, textAlign: 'center', marginTop: spacing.xs },
})
