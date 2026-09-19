import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { buttonRadius, colors, gradientPrimary, radii, shadows, spacing, typography } from '../theme/tokens'

export type CancelReason = { code: string; label: string }

export type CancelSheetProps = {
  visible: boolean
  reasons: CancelReason[]
  onClose: () => void
  onConfirm: (reasonCode: string) => Promise<void>
}

const SUBMIT_TIMEOUT_MS = 10_000

export function CancelSheet({ visible, reasons, onClose, onConfirm }: CancelSheetProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) {
      setSelected(null)
      setSubmitting(false)
      setTimedOut(false)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [visible])

  if (!visible) return null

  // Kept synchronous on purpose: RTL's fireEvent.press awaits whatever the
  // Pressable's onPress returns, so an async onPress that itself awaits
  // onConfirm() would make fireEvent.press hang forever whenever onConfirm
  // never resolves (exactly the case this component's 10s timeout exists
  // for). Firing the async work without awaiting it here keeps the event
  // handler's own return synchronous, so the timeout below fires and
  // re-renders on its own schedule instead of being gated on the press event.
  function handleConfirm() {
    if (!selected || submitting) return
    void submit(selected)
  }

  async function submit(reasonCode: string) {
    setSubmitting(true)
    setTimedOut(false)
    timeoutRef.current = setTimeout(() => {
      setSubmitting(false)
      setTimedOut(true)
    }, SUBMIT_TIMEOUT_MS)
    await onConfirm(reasonCode)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setSubmitting(false)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !submitting && onClose()}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !submitting && onClose()} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Why are you cancelling?</Text>

          <View style={styles.reasonList}>
            {reasons.map((r) => {
              const active = selected === r.code
              return (
                <Pressable
                  key={r.code}
                  onPress={() => setSelected(r.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.reasonRow, active ? styles.reasonRowActive : null]}
                >
                  <Text style={[styles.reasonLabel, active ? styles.reasonLabelActive : null]}>{r.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {timedOut ? <Text style={styles.timeoutText}>Taking longer than expected — try again.</Text> : null}

          <Pressable onPress={handleConfirm} disabled={!selected || submitting} style={styles.confirmWrap}>
            <LinearGradient
              colors={gradientPrimary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              accessibilityState={{ disabled: !selected || submitting }}
              style={[styles.confirmBtn, shadows.buttonPrimary, !selected ? styles.disabled : null]}
            >
              {submitting ? <ActivityIndicator color={colors.inkInverse} /> : <Text style={styles.confirmText}>Confirm cancellation</Text>}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.4)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: Math.max(spacing.lg, spacing.md),
  },
  handle: { width: 32, height: 4, borderRadius: radii.full, backgroundColor: colors.border, alignSelf: 'center', marginVertical: spacing.sm },
  title: { ...typography.title, color: colors.ink900, marginBottom: spacing.md },
  reasonList: { gap: spacing.md, marginBottom: spacing.md },
  reasonRow: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderLight, justifyContent: 'center', paddingHorizontal: spacing.md },
  reasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  reasonLabel: { ...typography.body, color: colors.ink900 },
  reasonLabelActive: { color: colors.primary, fontWeight: '600' },
  timeoutText: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  confirmWrap: { borderRadius: buttonRadius, overflow: 'hidden' },
  confirmBtn: { height: 48, borderRadius: buttonRadius, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  confirmText: { ...typography.body, color: colors.inkInverse, fontWeight: '600' },
})
