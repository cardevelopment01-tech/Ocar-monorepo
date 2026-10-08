import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import type { PaymentState } from './paymentMachine'

type Tone = 'info' | 'success' | 'warning' | 'error'
type View_ = { tone: Tone; title: string; body: string; spinner?: boolean; dismissible?: boolean }

export function describePayment(s: PaymentState): View_ | null {
  switch (s.phase) {
    case 'idle': return null
    case 'creating': return { tone: 'info', title: 'Preparing your payment', body: 'Just a moment…', spinner: true }
    case 'sdk': return { tone: 'info', title: 'Complete your payment', body: 'Finish paying in the PayU window.', spinner: true }
    case 'confirming':
      return { tone: 'info', title: 'Confirming your payment', body: "Please don't close the app.", spinner: true }
    case 'credited':
      return {
        tone: 'success', dismissible: true,
        title: 'Payment received',
        body: s.kind === 'package' ? 'Your package is active.' : 'Your wallet has been updated.',
      }
    case 'pending':
      return {
        tone: 'warning', dismissible: true,
        title: 'Payment is being processed',
        body: 'Your balance will update shortly. You can leave this screen.',
      }
    case 'cancelled': return { tone: 'info', title: 'Payment cancelled', body: 'You were not charged.', dismissible: true }
    case 'failed':
      return {
        tone: 'error', dismissible: true,
        title: s.reason === 'unavailable' ? 'In-app payment unavailable' : s.reason === 'order' ? "Couldn't start the payment" : 'Payment failed',
        body:
          s.reason === 'unavailable' ? 'Please try again later.'
          : s.reason === 'order' ? 'Check your connection and try again.'
          : 'If money was debited, your bank will refund it within 5–7 working days.',
      }
  }
}

const TONE: Record<Tone, { bg: string; border: string; fg: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  info: { bg: colors.surface2, border: colors.border, fg: colors.ink900, icon: 'info' },
  success: { bg: colors.successLight, border: colors.success, fg: colors.success, icon: 'check-circle' },
  warning: { bg: colors.warningLight, border: colors.warning, fg: '#8A6420', icon: 'clock' },
  error: { bg: colors.errorLight, border: colors.error, fg: colors.error, icon: 'alert-circle' },
}

export function PaymentStatus({ state, onDismiss }: { state: PaymentState; onDismiss: () => void }) {
  const v = describePayment(state)
  if (!v) return null
  const t = TONE[v.tone]
  return (
    <View style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityLiveRegion="polite">
      {v.spinner ? <ActivityIndicator color={colors.primary} /> : <Feather name={t.icon} size={20} color={t.fg} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.fg }]}>{v.title}</Text>
        <Text style={styles.body}>{v.body}</Text>
      </View>
      {v.dismissible ? (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Dismiss">
          <Feather name="x" size={18} color={colors.ink400} />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radii.lg, borderWidth: 1, padding: spacing.md },
  title: { ...typography.body, fontFamily: fonts.bold },
  body: { ...typography.caption, color: colors.ink600, marginTop: 2 },
})
