import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { Button, ErrorState, Skeleton, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchPackageLedger, fetchPackageTiers, fetchPackageWallet, type PackageLedgerEntry, type PackageTier, type PackageWallet } from './api'
import { daysLeft, ledgerLine, packageStatus } from './packageStatus'

// Whole rupees drop the decimals, paise keep two ("₹47.20", "₹550"); Indian grouping.
const money = (v: string | number): string => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return Math.abs(n).toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const day = (iso: string): string => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const TONE = {
  error: { bg: colors.errorLight, fg: colors.error, icon: 'alert-circle' as const },
  warn: { bg: colors.warningLight, fg: '#8A6420', icon: 'alert-triangle' as const },
  info: { bg: colors.infoLight, fg: colors.primary, icon: 'clock' as const },
}

/**
 * The ride-credit screen for a driver on a package plan: how much credit is left and when it expires, a plain-words notice when
 * ride requests have stopped (or are about to), the plans with the GST shown on top of the price, and what the credit was used for.
 * `balance` is what the server uses to decide who gets ride offers.
 */
export function PackageWalletView({ busy, onBuy, refreshKey }: { busy: boolean; onBuy: (tierId: string) => void; refreshKey: number }) {
  const [tiers, setTiers] = useState<PackageTier[] | null>(null)
  const [wallet, setWallet] = useState<PackageWallet | null>(null)
  const [ledger, setLedger] = useState<PackageLedgerEntry[]>([])
  const [error, setError] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(false)
    fetchPackageTiers().then(setTiers).catch(() => setError(true))
    fetchPackageWallet().then(setWallet).catch(() => undefined)
    fetchPackageLedger().then(setLedger).catch(() => undefined)
  }, [])
  // refreshKey bumps after a payment settles, so the balance and activity update without leaving the screen.
  useEffect(load, [load, refreshKey])

  if (error && !tiers) return <ErrorState message="Couldn't load your ride credit" onRetry={load} />
  if (!tiers || !wallet) return <Skeleton height={220} borderRadius={24} />

  const balance = parseFloat(wallet.balance)
  const status = packageStatus({ balance, frozen: wallet.is_frozen, lots: wallet.lots ?? [] })
  const bad = status.state === 'empty' || status.state === 'overdrawn' || status.state === 'frozen'
  const lots = wallet.lots ?? []

  return (
    <View style={styles.stack}>
      <LinearGradient
        colors={bad ? ['#7A2E2E', '#B64B4B'] : status.state === 'low' ? ['#7A5618', '#B98A32'] : ['#0B4A50', '#0E8FA3']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}
      >
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>RIDE CREDIT</Text>
          <View style={styles.chip}><Text style={styles.chipText}>{status.chip}</Text></View>
        </View>
        <Text style={styles.heroValue}>{balance < 0 ? '−' : ''}₹{money(balance)}</Text>
        <Text style={styles.heroHint}>
          {lots.length > 0 && wallet.next_expiry ? `Next expiry ${day(wallet.next_expiry)}` : 'Each ride you complete uses its fare from this credit'}
        </Text>
      </LinearGradient>

      {status.notice ? (
        <View style={[styles.notice, { backgroundColor: TONE[status.notice.tone].bg }]} accessibilityRole="alert">
          <Feather name={TONE[status.notice.tone].icon} size={18} color={TONE[status.notice.tone].fg} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.noticeTitle, { color: TONE[status.notice.tone].fg }]}>{status.notice.title}</Text>
            <Text style={styles.noticeBody}>{status.notice.message}</Text>
          </View>
        </View>
      ) : null}

      {lots.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your credit</Text>
          {lots.map((l, i) => {
            const left = daysLeft(l.expires_at, new Date())
            return (
              <View key={`${l.expires_at}-${i}`} style={[styles.lotRow, i < lots.length - 1 ? styles.rowBorder : null]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lotAmount}>₹{money(l.remaining)} left</Text>
                  <Text style={styles.muted}>Expires {day(l.expires_at)}</Text>
                </View>
                <View style={[styles.daysPill, left <= 30 ? { backgroundColor: colors.warningLight } : null]}>
                  <Text style={[styles.daysText, left <= 30 ? { color: '#8A6420' } : null]}>{left} {left === 1 ? 'day' : 'days'} left</Text>
                </View>
              </View>
            )
          })}
          <Text style={styles.finePrint}>Rides use the credit that expires first.</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add ride credit</Text>
        {tiers.length === 0 ? <Text style={styles.muted}>No plans are available right now. Please check again soon.</Text> : null}
        {tiers.map((t, i) => {
          const hasGst = !!t.gst_amount && parseFloat(t.gst_amount) > 0
          return (
            <View key={t.id} style={[styles.planRow, i < tiers.length - 1 ? styles.rowBorder : null]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.planCredit}>₹{money(t.threshold_value)} <Text style={styles.planCreditSuffix}>ride credit</Text></Text>
                <Text style={styles.planPay}>Pay ₹{money(t.total_amount ?? t.price)}</Text>
                {hasGst ? <Text style={styles.muted}>₹{money(t.price)} plan + ₹{money(t.gst_amount!)} GST ({t.gst_percent}%)</Text> : null}
                {t.validity_days ? <Text style={styles.muted}>Valid {t.validity_days} days from purchase</Text> : null}
              </View>
              <Button
                label="Recharge"
                loading={busy && chosen === t.id}
                disabled={busy}
                onPress={() => { setChosen(t.id); onBuy(t.id) }}
              />
            </View>
          )
        })}
        <Text style={styles.finePrint}>UPI, cards and net banking. Secured by PayU. Credit that is not used within its validity expires and is not refunded.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent activity</Text>
        {ledger.length === 0 ? <Text style={styles.muted}>No activity yet.</Text> : ledger.slice(0, 15).map((e, i, arr) => {
          const line = ledgerLine(e)
          const credit = e.direction === 'credit'
          return (
            <View key={e.id} style={[styles.actRow, i < arr.length - 1 ? styles.rowBorder : null]}>
              <View style={[styles.actIcon, { backgroundColor: credit ? colors.successLight : colors.errorLight }]}>
                <Feather name={e.entry_type === 'expiry' ? 'clock' : credit ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={credit ? colors.success : colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actTitle} numberOfLines={1}>{line.title}</Text>
                <Text style={styles.muted} numberOfLines={1}>{line.subtitle ? `${line.subtitle} · ` : ''}{day(e.created_at)}</Text>
              </View>
              <Text style={[styles.actAmount, { color: credit ? colors.success : colors.ink900 }]}>{line.sign}₹{money(e.amount)}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  hero: { borderRadius: 24, padding: spacing.lg, boxShadow: '0 12px 28px rgba(14,143,163,0.22)' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { ...typography.label, color: 'rgba(255,255,255,0.72)', fontFamily: fonts.bold, letterSpacing: 1 },
  chip: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radii.full, paddingHorizontal: 12, paddingVertical: 4 },
  chipText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.bold },
  heroValue: { fontSize: 44, lineHeight: 52, fontFamily: fonts.bold, color: colors.inkInverse, marginTop: 6 },
  heroHint: { ...typography.caption, color: 'rgba(255,255,255,0.78)', marginTop: 4 },
  notice: { flexDirection: 'row', gap: spacing.sm, borderRadius: radii.lg, padding: spacing.md },
  noticeTitle: { ...typography.body, fontFamily: fonts.bold },
  noticeBody: { ...typography.caption, color: colors.ink600, marginTop: 2, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, marginBottom: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  muted: { ...typography.caption, color: colors.ink400 },
  finePrint: { ...typography.caption, color: colors.ink400, marginTop: spacing.sm, lineHeight: 18 },
  lotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  lotAmount: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  daysPill: { backgroundColor: colors.surface2, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 4 },
  daysText: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  planCredit: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  planCreditSuffix: { ...typography.caption, color: colors.ink400, fontFamily: fonts.medium },
  planPay: { ...typography.body, color: colors.primary, fontFamily: fonts.bold },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  actIcon: { width: 36, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  actTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  actAmount: { ...typography.body, fontFamily: fonts.bold },
})
