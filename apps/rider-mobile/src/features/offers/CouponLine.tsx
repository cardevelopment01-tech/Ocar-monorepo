import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Skeleton, colors, fonts, spacing, typography } from '@ocar/mobile-shared'
import { formatRupees, type CouponLineState } from './offerModel'

type Props = {
  state: CouponLineState
  onOpenSheet: () => void
  onRemove: () => void
  onRetry: () => void
}

// The coupon line sits inside the fare footer under the payment row (design review D3/D4/D7): one 48px row that is
// "Have a code?" when idle, the applied offer with Remove or Change, the server's reason when a code was refused, or a
// quiet note when the check failed. It adds nothing at all while offers are off. Status is always icon + words, never
// colour alone, and the money-green text uses the AA-safe moneyInk.
export function CouponLine({ state, onOpenSheet, onRemove, onRetry }: Props) {
  if (state.kind === 'off') return null

  if (state.kind === 'loading') {
    return (
      <View style={styles.row} accessibilityLabel="Checking your offer" accessible>
        <Skeleton width={180} height={16} />
      </View>
    )
  }

  if (state.kind === 'idle') {
    return (
      <Pressable style={styles.row} onPress={onOpenSheet} accessibilityRole="button" accessibilityLabel="Have a code? Add an offer code">
        <Feather name="tag" size={16} color={colors.ink600} />
        <Text style={styles.idle}>Have a code?</Text>
        <Feather name="chevron-right" size={16} color={colors.ink400} />
      </Pressable>
    )
  }

  if (state.kind === 'applied') {
    const title = state.auto ? 'Best offer applied' : `${state.offer.code ?? state.offer.name} applied`
    const detail = state.auto ? state.offer.summary : `You save ${formatRupees(state.offer.discount)}`
    return (
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Feather name="check-circle" size={16} color={colors.moneyInk} />
        <View style={styles.textCol}>
          <Text style={styles.applied} numberOfLines={2}>{title} · {detail}</Text>
        </View>
        {/* Remove for a typed code, Change (opens the sheet, where Remove also lives) for an automatic one. */}
        <Pressable style={styles.action} onPress={state.auto ? onOpenSheet : onRemove} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={state.auto ? 'Change offer' : `Remove ${state.offer.code ?? 'offer'}`}>
          <Text style={styles.actionText}>{state.auto ? 'Change' : 'Remove'}</Text>
        </Pressable>
      </View>
    )
  }

  if (state.kind === 'rejected') {
    return (
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Feather name="alert-circle" size={16} color={colors.error} />
        <View style={styles.textCol}><Text style={styles.problem} numberOfLines={2}>{state.message}</Text></View>
        <Pressable style={styles.action} onPress={onOpenSheet} hitSlop={6} accessibilityRole="button" accessibilityLabel="Change offer code">
          <Text style={styles.actionText}>Change</Text>
        </Pressable>
      </View>
    )
  }

  // error: a failed check never blocks booking, and the rider is told so.
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Feather name="alert-circle" size={16} color={colors.ink600} />
      <View style={styles.textCol}>
        <Text style={styles.note} numberOfLines={2}>Couldn&apos;t check the offer. You can still book at {formatRupees(state.fullPrice)}</Text>
      </View>
      <Pressable style={styles.action} onPress={onRetry} hitSlop={6} accessibilityRole="button" accessibilityLabel="Check the offer again">
        <Text style={styles.actionText}>Retry</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  // 48px: the target is the whole row, comfortably over the 44px minimum.
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, marginBottom: spacing.xs },
  textCol: { flex: 1, minWidth: 0 },
  idle: { ...typography.body, flex: 1, fontFamily: fonts.semibold, color: colors.ink600 },
  applied: { ...typography.body, fontFamily: fonts.semibold, color: colors.moneyInk },
  problem: { ...typography.body, fontFamily: fonts.semibold, color: colors.ink900 },
  note: { ...typography.body, color: colors.ink600 },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  actionText: { ...typography.body, fontFamily: fonts.bold, color: colors.primaryDark },
})
