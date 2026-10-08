import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, ErrorState, Skeleton, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchPackageTiers, type PackageTier } from './api'

const rupees = (v: string): string => parseFloat(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })

// Package-mode drivers prepay ride credit by tier (mirrors the web RechargePackage page).
export function PackageCard({ busy, onBuy }: { busy: boolean; onBuy: (tierId: string) => void }) {
  const [tiers, setTiers] = useState<PackageTier[] | null>(null)
  const [error, setError] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)

  const load = (): void => {
    setError(false)
    fetchPackageTiers().then(setTiers).catch(() => setError(true))
  }
  useEffect(load, [])

  if (error) return <ErrorState message="Couldn't load packages" onRetry={load} />
  if (!tiers) return <Skeleton height={144} borderRadius={24} />
  if (tiers.length === 0) return <Text style={styles.note}>No packages available right now.</Text>

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Recharge package</Text>
      {tiers.map((t) => (
        <View key={t.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.price}>₹{rupees(t.price)}</Text>
            <Text style={styles.credit}>Ride credit ₹{rupees(t.threshold_value)}</Text>
          </View>
          <Button
            label="Buy"
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
