import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { Button, ErrorState, Skeleton, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchPackageLedger, fetchPackageTiers, fetchPackageWallet, type PackageLedgerEntry, type PackageTier, type PackageWallet } from './api'
import { InvoicesCard } from './InvoicesCard'
import { daysLeft, ledgerLine, packageStatus } from './packageStatus'

// Whole rupees drop the decimals, paise keep two ("₹47.20", "₹550"); Indian grouping.
const money = (v: string | number): string => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return Math.abs(n).toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Prices always carry paise so a column of them lines up ("₹295.00" beside "₹47.20"); credit amounts stay whole.
const price2 = (v: string | number): string => parseFloat(String(v)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (iso: string): string => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// Amber used for "expiring soon" (swatch/bar) and its text, one pair so the screen never mixes two ambers.
const SOON = '#F5C46B'
const WARN_INK = '#7A5618'
const TONE = {
  error: { bg: colors.errorLight, fg: colors.error, icon: 'alert-circle' as const },
  warn: { bg: colors.warningLight, fg: WARN_INK, icon: 'alert-triangle' as const },
  info: { bg: colors.infoLight, fg: colors.primary, icon: 'clock' as const },
}

/**
 * The ride-credit screen for a driver on a package plan: how much credit is left and when it expires, a plain-words notice when
 * ride requests have stopped (or are about to), the plans as a list with the GST broken out, and what the credit was used for.
 * `balance` is what the server uses to decide who gets ride offers.
 */
export function PackageWalletView({ busy, onBuy, refreshKey }: { busy: boolean; onBuy: (tierId: string) => void; refreshKey: number }) {
  const [tiers, setTiers] = useState<PackageTier[] | null>(null)
  const [wallet, setWallet] = useState<PackageWallet | null>(null)
  const [ledger, setLedger] = useState<PackageLedgerEntry[]>([])
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(false)
    fetchPackageTiers().then(setTiers).catch(() => setError(true))
    fetchPackageWallet().then(setWallet).catch(() => setError(true))
    fetchPackageLedger().then(setLedger).catch(() => undefined)
  }, [])
  // refreshKey bumps after a payment settles, so the balance and activity update without leaving the screen.
  useEffect(load, [load, refreshKey])

  if (error && (!tiers || !wallet)) return <ErrorState message="Couldn't load your ride credit" onRetry={load} />
  if (!tiers || !wallet) return <Skeleton height={220} borderRadius={24} />

  const balance = parseFloat(wallet.balance)
  const status = packageStatus({ balance, frozen: wallet.is_frozen, lots: wallet.lots ?? [] })
  const bad = status.state === 'empty' || status.state === 'overdrawn' || status.state === 'frozen'
  const lots = wallet.lots ?? []
  const liveLots = lots.filter((l) => parseFloat(l.remaining) > 0)
  const liveTotal = liveLots.reduce((s, l) => s + parseFloat(l.remaining), 0)
  const selected = tiers.find((t) => t.id === picked) ?? tiers[0] ?? null
  const owed = balance < 0 ? -balance : 0

  return (
    <View style={styles.stack}>
      <LinearGradient
        colors={bad ? ['#7A2E2E', '#A94444'] : status.state === 'low' ? ['#6B4A12', '#9A6F1F'] : ['#0B4A50', '#0E8FA3']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}
      >
        <View style={styles.heroTop}>
          <Text style={styles.heroLabel}>RIDE CREDIT</Text>
          <View style={styles.chip}><Text style={styles.chipText}>{status.chip}</Text></View>
        </View>
        <Text style={styles.heroValue}>{balance < 0 ? '−' : ''}₹{money(balance)}</Text>
        <Text style={styles.heroHint}>
          {bad ? 'Ride requests are paused' : lots.length > 0 && wallet.next_expiry ? `Next expiry ${day(wallet.next_expiry)}` : 'Each ride you complete uses its fare from this credit'}
        </Text>
        {liveLots.length > 1 && liveTotal > 0 ? (
          <View style={styles.barWrap}>
            <View style={styles.bar}>
              {liveLots.map((l, i) => {
                const soon = daysLeft(l.expires_at, new Date()) <= 30
                return <View key={`${l.expires_at}-${i}`} style={{ flex: parseFloat(l.remaining), borderRadius: 5, backgroundColor: soon ? SOON : 'rgba(255,255,255,0.88)' }} />
              })}
            </View>
            <View style={styles.legend}>
              {liveLots.map((l, i) => <Text key={`${l.expires_at}-${i}`} style={styles.legendText}>₹{money(l.remaining)} · {daysLeft(l.expires_at, new Date())}d</Text>)}
            </View>
          </View>
        ) : null}
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

      {liveLots.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your credit</Text>
          {liveLots.map((l, i) => {
            const left = daysLeft(l.expires_at, new Date())
            const soon = left <= 30
            return (
              <View key={`${l.expires_at}-${i}`} style={[styles.lotRow, i < liveLots.length - 1 ? styles.rowBorder : null]}>
                <View style={[styles.swatch, { backgroundColor: soon ? SOON : colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.lotAmount}>₹{money(l.remaining)} left</Text>
                  <Text style={styles.muted}>Expires {day(l.expires_at)}</Text>
                </View>
                <View style={[styles.daysPill, soon ? { backgroundColor: colors.warningLight } : null]}>
                  <Text style={[styles.daysText, soon ? { color: WARN_INK } : null]}>{left} {left === 1 ? 'day' : 'days'} left</Text>
                </View>
              </View>
            )
          })}
          <Text style={styles.finePrint}>Rides use the credit that expires first.</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Ride credit plans</Text>
      <Text style={styles.lead}>Prices include GST. Pick a plan, then pay.</Text>
      {tiers.length === 0 ? <Text style={styles.muted}>No plans are available right now. Please check again soon.</Text> : null}
      {tiers.map((t) => {
        const on = selected?.id === t.id
        const hasGst = !!t.gst_amount && parseFloat(t.gst_amount) > 0
        return (
          <Pressable
            key={t.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`₹${money(t.threshold_value)} ride credit, pay ₹${price2(t.total_amount ?? t.price)}`}
            onPress={() => setPicked(t.id)}
            style={[styles.plan, on ? styles.planOn : null]}
          >
            <View style={styles.planHead}>
              <View style={[styles.radio, on ? styles.radioOn : null]}>{on ? <Feather name="check" size={13} color={colors.inkInverse} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.planCredit}>₹{money(t.threshold_value)}</Text>
                <Text style={styles.planSub}>ride credit</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.planSub}>You pay</Text>
                <Text style={[styles.planPay, on ? { color: colors.primary } : null]}>₹{price2(t.total_amount ?? t.price)}</Text>
              </View>
            </View>
            <View style={styles.planBreak}>
              <View style={styles.cell}><Text style={styles.planSub}>Plan price</Text><Text style={styles.cellVal}>₹{price2(t.price)}</Text></View>
              <View style={[styles.cell, { alignItems: 'center' }]}>
                <Text style={styles.planSub}>{hasGst ? `GST ${t.gst_percent}%` : 'GST'}</Text>
                <Text style={styles.cellVal}>{hasGst ? `₹${price2(t.gst_amount!)}` : '—'}</Text>
              </View>
              <View style={[styles.cell, { alignItems: 'flex-end' }]}>
                <Text style={styles.planSub}>Valid for</Text>
                <Text style={styles.cellVal}>{t.validity_days ? `${t.validity_days} days` : '—'}</Text>
              </View>
            </View>
            {on ? (
              // The Pay button lives in the selected card, next to the price it charges: nothing floats over the list, and the action
              // follows the driver's choice. The label carries the exact amount.
              <View style={styles.planPayRow}>
                <Button label={`Pay ₹${price2(t.total_amount ?? t.price)}`} loading={busy} disabled={busy} onPress={() => onBuy(t.id)} />
                <Text style={styles.planPayHint}>incl. GST · UPI, cards, net banking</Text>
              </View>
            ) : null}
          </Pressable>
        )
      })}

      {selected && owed > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What this recharge gives you</Text>
          <View style={styles.sumRow}><Text style={styles.sumLabel}>Ride credit bought</Text><Text style={styles.sumVal}>₹{money(selected.threshold_value)}</Text></View>
          <View style={styles.sumRow}><Text style={styles.sumLabel}>Clears what you owe</Text><Text style={styles.sumVal}>−₹{money(owed)}</Text></View>
          <View style={[styles.sumRow, styles.sumTotal]}><Text style={styles.sumTotalLabel}>Credit you can use</Text><Text style={styles.sumTotalVal}>₹{money(Math.max(0, parseFloat(selected.threshold_value) - owed))}</Text></View>
        </View>
      ) : null}

      <Text style={styles.finePrint}>UPI, cards and net banking. Secured by PayU. Credit that is not used within its validity expires and is not refunded.</Text>

      <InvoicesCard refreshKey={refreshKey} />

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
  heroLabel: { ...typography.label, color: 'rgba(255,255,255,0.85)', fontFamily: fonts.bold, letterSpacing: 1 },
  chip: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radii.full, paddingHorizontal: 12, paddingVertical: 4 },
  chipText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.bold },
  heroValue: { fontSize: 44, lineHeight: 52, fontFamily: fonts.bold, color: colors.inkInverse, marginTop: 6 },
  heroHint: { ...typography.caption, color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  barWrap: { marginTop: spacing.md },
  bar: { flexDirection: 'row', gap: 4, height: 10 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  legendText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.semibold },
  notice: { flexDirection: 'row', gap: spacing.sm, borderRadius: radii.lg, padding: spacing.md },
  noticeTitle: { ...typography.body, fontFamily: fonts.bold },
  noticeBody: { ...typography.caption, color: colors.ink600, marginTop: 2, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, marginBottom: spacing.sm },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  muted: { ...typography.caption, color: colors.ink600 },
  finePrint: { ...typography.caption, color: colors.ink600, marginTop: spacing.xs, lineHeight: 18 },
  lotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  swatch: { width: 10, height: 36, borderRadius: 5 },
  lotAmount: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  daysPill: { backgroundColor: colors.surface2, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 4 },
  daysText: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  sectionLabel: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, marginTop: spacing.xs },
  lead: { ...typography.caption, color: colors.ink600, marginTop: -spacing.sm },
  plan: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  planOn: { borderWidth: 1.5, borderColor: colors.primary, boxShadow: '0 8px 22px rgba(14,143,163,0.14)' },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.ink400, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  planCredit: { fontSize: 24, lineHeight: 28, fontFamily: fonts.bold, color: colors.ink900 },
  planSub: { ...typography.caption, color: colors.ink600, fontFamily: fonts.semibold },
  planPay: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold, color: colors.ink900 },
  planBreak: { flexDirection: 'row', marginTop: spacing.sm + 2, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderStyle: 'dashed' },
  cell: { flex: 1 },
  cellVal: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, marginTop: 2 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  sumLabel: { ...typography.body, color: colors.ink600 },
  sumVal: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  sumTotal: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 10 },
  sumTotalLabel: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  sumTotalVal: { ...typography.title, color: colors.primary, fontFamily: fonts.bold },
  planPayRow: { marginTop: spacing.md, gap: spacing.xs },
  planPayHint: { ...typography.caption, color: colors.ink600, textAlign: 'center' },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  actIcon: { width: 36, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  actTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  actAmount: { ...typography.body, fontFamily: fonts.bold },
})
