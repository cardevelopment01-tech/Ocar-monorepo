import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { EmptyState, ErrorState, Skeleton, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchBillingMode, fetchDriverWallet, type DriverWallet, type LedgerEntry } from '@/features/wallet/api'

// Same "temporarily disabled" gate as the web Wallet.tsx -- MIN_BALANCE is a
// ponytail: client requested the recharge gate off for driver testing (see
// CLAUDE.md's Pending Ops Actions). This is the cosmetic low-balance banner
// only, not an enforcement gate -- useWalletGate.ts's own MIN_BALANCE (which
// DOES gate Go Online) is a separate constant, already mirrored to -999999.
const MIN_BALANCE = 0

function entryLabel(e: LedgerEntry): string {
  switch (e.entry_type) {
    case 'commission_debit': return e.note ?? 'Commission deduction'
    case 'topup': return 'Wallet top-up'
    case 'adjustment_credit': return 'Admin credit adjustment'
    case 'adjustment_debit': return 'Admin debit adjustment'
    case 'refund_credit': return 'Refund credit'
    default: return e.entry_type.replace(/_/g, ' ')
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function WalletScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [wallet, setWallet] = useState<DriverWallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [packageMode, setPackageMode] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      // Package-mode drivers (billing_mode='package') get a prepaid ride-credit
      // balance, not this commission deposit wallet -- no mobile screen for that
      // exists yet (web's RechargePackage.tsx), so this shows a plain notice
      // rather than fetching data that wouldn't apply to them.
      const billingMode = await fetchBillingMode()
      if (billingMode === 'package') {
        setPackageMode(true)
        setLoading(false)
        return
      }
      setWallet(await fetchDriverWallet())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const balance = wallet ? parseFloat(wallet.balance) : 0
  const isLow = !packageMode && balance < MIN_BALANCE
  const ledger = wallet?.recent_ledger ?? []

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink600} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Wallet</Text>
          <Text style={styles.subtitle}>Compliance deposit</Text>
        </View>
        {!loading ? (
          <Pressable onPress={() => void load()} style={styles.refreshBtn} accessibilityLabel="Refresh wallet">
            <Feather name="refresh-cw" size={15} color={colors.ink600} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {packageMode ? (
          <EmptyState title="Package billing" description="Your account uses prepaid ride packages, not a deposit wallet. Contact support for package details." />
        ) : loading ? (
          <Skeleton height={144} borderRadius={24} />
        ) : (
          <>
            <View style={[styles.balanceCard, { backgroundColor: isLow ? colors.warning : colors.success }]}>
              <Text style={styles.balanceLabel}>Compliance deposit</Text>
              <Text style={styles.balanceValue}>₹{formatMoney(balance)}</Text>
              <Text style={styles.balanceHint}>Minimum required: ₹{MIN_BALANCE.toLocaleString('en-IN')}</Text>
            </View>

            {isLow ? (
              <View style={styles.warningBanner}>
                <Feather name="alert-triangle" size={18} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>Low Balance</Text>
                  <Text style={styles.warningBody}>Add ₹{formatMoney(MIN_BALANCE - balance)} to avoid service interruption</Text>
                </View>
              </View>
            ) : null}

            {wallet?.is_frozen ? (
              <View style={styles.errorBanner}>
                <Feather name="alert-triangle" size={18} color={colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.errorTitle}>Wallet Frozen</Text>
                  <Text style={styles.errorBody}>Contact support to unfreeze your wallet</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.ledgerCard}>
              <Text style={styles.ledgerTitle}>Recent Transactions</Text>
              {error ? (
                <ErrorState message="Failed to load transactions" onRetry={load} />
              ) : ledger.length === 0 ? (
                <Text style={styles.emptyText}>No transactions yet</Text>
              ) : (
                ledger.map((tx, i) => (
                  <View key={tx.id} style={[styles.ledgerRow, i < ledger.length - 1 ? styles.ledgerRowBorder : null]}>
                    <View style={[styles.ledgerIcon, { backgroundColor: tx.direction === 'credit' ? colors.successLight : colors.errorLight }]}>
                      <Feather
                        name={tx.direction === 'credit' ? 'arrow-down-left' : 'arrow-up-right'}
                        size={16}
                        color={tx.direction === 'credit' ? colors.success : colors.error}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ledgerLabel} numberOfLines={1}>{entryLabel(tx)}</Text>
                      <Text style={styles.ledgerDate}>{formatDate(tx.created_at)}</Text>
                    </View>
                    <Text style={[styles.ledgerAmount, { color: tx.direction === 'credit' ? colors.success : colors.error }]}>
                      {tx.direction === 'credit' ? '+' : '-'}₹{formatMoney(parseFloat(tx.amount))}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800' },
  subtitle: { ...typography.caption, color: colors.ink400 },
  refreshBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  balanceCard: { borderRadius: radii['2xl'], padding: spacing.lg },
  balanceLabel: { ...typography.label, color: 'rgba(255,255,255,0.7)', fontWeight: '700' },
  balanceValue: { fontSize: 40, fontWeight: '800', color: colors.inkInverse, marginTop: 4 },
  balanceHint: { ...typography.caption, color: 'rgba(255,255,255,0.7)', marginTop: spacing.sm },
  warningBanner: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.warning },
  warningTitle: { ...typography.body, color: colors.warning, fontWeight: '700' },
  warningBody: { ...typography.caption, color: colors.ink600, marginTop: 2 },
  errorBanner: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.errorLight, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.error },
  errorTitle: { ...typography.body, color: colors.error, fontWeight: '700' },
  errorBody: { ...typography.caption, color: colors.ink600, marginTop: 2 },
  ledgerCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  ledgerTitle: { ...typography.body, color: colors.ink900, fontWeight: '700', marginBottom: spacing.sm },
  emptyText: { ...typography.body, color: colors.ink400, textAlign: 'center', paddingVertical: spacing.md },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 4 },
  ledgerRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  ledgerIcon: { width: 36, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  ledgerLabel: { ...typography.body, color: colors.ink900, fontWeight: '600' },
  ledgerDate: { ...typography.caption, color: colors.ink400, marginTop: 1 },
  ledgerAmount: { ...typography.body, fontWeight: '700' },
})
