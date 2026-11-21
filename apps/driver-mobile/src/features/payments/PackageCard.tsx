import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, ErrorState, Skeleton, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchPackageTiers, fetchPackageWallet, type PackageTier, type PackageWallet } from './api'

// Whole rupees drop the decimals, paise keep two ("₹47.20", "₹550").
const rupees = (v: string): string => {
  const n = parseFloat(v)
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return n.toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const day = (iso: string): string => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// Package-mode drivers prepay ride credit by tier (mirrors the web RechargePackage page).
export function PackageCard({ busy, onBuy }: { busy: boolean; onBuy: (tierId: string) => void }) {
  const [tiers, setTiers] = useState<PackageTier[] | null>(null)
  const [error, setError] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [wallet, setWallet] = useState<PackageWallet | null>(null)

  const load = (): void => {
    setError(false)
    fetchPackageTiers().then(setTiers).catch(() => setError(true))
    // The balance strip is a convenience: a failed fetch just leaves it out.
    fetchPackageWallet().then(setWallet).catch(() => undefined)
  }
  useEffect(load, [])

  if (error) return <ErrorState message="Couldn't load packages" onRetry={load} />
  if (!tiers) return <Skeleton height={144} borderRadius={24} />
  if (tiers.length === 0) return <Text style={styles.note}>No packages available right now.</Text>

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Add ride credit</Text>
      {wallet && parseFloat(wallet.balance) > 0 ? (
        <Text style={styles.note}>
          Ride credit left ₹{rupees(wallet.balance)}{wallet.next_expiry ? ` · next expiry ${day(wallet.next_expiry)}` : ''}
        </Text>
      ) : null}
      {tiers.map((t) => (
        <View key={t.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.price}>₹{rupees(t.total_amount ?? t.price)}</Text>
            {t.gst_amount && parseFloat(t.gst_amount) > 0 ? (
              <Text style={styles.credit}>₹{rupees(t.price)} + ₹{rupees(t.gst_amount)} GST ({t.gst_percent}%)</Text>
            ) : null}
            <Text style={styles.credit}>
              {t.label ? `${t.label} · ` : ''}Ride credit ₹{rupees(t.threshold_value)}{t.validity_days ? ` · valid ${t.validity_days} days` : ''}
            </Text>
          </View>
          <Button
            label="Recharge"
            loading={busy && chosen === t.id}
            disabled={busy}
            onPress={() => { setChosen(t.id); onBuy(t.id) }}
          />
        </View>
      ))}
      <Text style={styles.note}>UPI, cards and net banking. Secured by PayU.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  title: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  price: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  credit: { ...typography.caption, color: colors.ink400 },
  note: { ...typography.caption, color: colors.ink400, textAlign: 'center' },
})
