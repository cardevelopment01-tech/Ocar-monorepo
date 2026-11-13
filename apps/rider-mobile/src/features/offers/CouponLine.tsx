import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Skeleton, font, h } from '@ocar/mobile-shared'
import { formatRupees, type CouponLineState } from './offerModel'
import { OfferTicket } from './OfferTicket'

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
      <Pressable style={styles.idleRow} onPress={onOpenSheet} accessibilityRole="button" accessibilityLabel="Have a code? Add an offer code">
        <View style={styles.idleBadge}><Feather name="tag" size={16} color={h.tealText} /></View>
        <View style={styles.textCol}>
          <Text style={styles.idle}>Have a code?</Text>
          <Text style={styles.idleSub}>Add it to save on this ride</Text>
        </View>
        <Feather name="chevron-right" size={18} color={h.faint} />
      </Pressable>
    )
  }

  if (state.kind === 'applied') {
    const title = state.auto ? 'Best offer applied' : `${state.offer.code ?? state.offer.name} applied`
    const detail = state.auto ? state.offer.summary : `You save ${formatRupees(state.offer.discount)}`
    return (
      <View style={styles.ticketWrap} accessibilityLiveRegion="polite">
        <OfferTicket
          tone="applied" animateIn notch={h.surface}
          title={state.auto ? 'Best offer applied' : (state.offer.code ?? state.offer.name)}
          subtitle={state.auto ? detail : `${state.offer.summary}`}
          saving={`Save ${formatRupees(state.offer.discount)}`}
          accessibilityLabel={`${title}. ${detail}`}
          right={
            /* Remove for a typed code, Change (opens the sheet, where Remove also lives) for an automatic one. */
            <Pressable style={styles.action} onPress={state.auto ? onOpenSheet : onRemove} hitSlop={6} accessibilityRole="button"
              accessibilityLabel={state.auto ? 'Change offer' : `Remove ${state.offer.code ?? 'offer'}`}>
              <Text style={styles.actionText}>{state.auto ? 'Change' : 'Remove'}</Text>
            </Pressable>
          }
        />
      </View>
    )
  }

  if (state.kind === 'rejected') {
    return (
      <View style={styles.row} accessibilityLiveRegion="polite">
        <Feather name="alert-circle" size={16} color={h.danger} />
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
      <Feather name="alert-circle" size={16} color={h.muted} />
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginBottom: 4 },
  textCol: { flex: 1, minWidth: 0 },
  idleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, marginBottom: 4, paddingHorizontal: 8, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: h.line10 },
  idleBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  idle: { fontSize: 14.5, lineHeight: 21, fontFamily: font.sb, color: h.ivory },
  idleSub: { fontFamily: font.m, fontSize: 12.5, lineHeight: 18, color: h.muted },
  ticketWrap: { marginBottom: 4 },
  applied: { fontSize: 14.5, lineHeight: 21, fontFamily: font.sb, color: h.tealText },
  problem: { fontSize: 14.5, lineHeight: 21, fontFamily: font.sb, color: h.ivory },
  note: { fontFamily: font.r, fontSize: 14.5, lineHeight: 21, color: h.muted },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  actionText: { fontSize: 14.5, lineHeight: 21, fontFamily: font.b, color: h.tealText },
})
