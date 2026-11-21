import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { fetchPackageInvoiceLink, fetchPackageInvoices, type PackageInvoiceRow } from './api'

const rupees = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
// 'YYYY-MM-DD' (an IST calendar date) without letting the phone's time zone shift it.
const calDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' })

/** What an invoice is for, in a few words: a plan purchase, or the commission for a period. */
function subtitle(inv: PackageInvoiceRow): string {
  if (inv.kind === 'commission' && inv.period_start && inv.period_end) {
    const rides = inv.ride_count ?? 0
    return `Commission · ${calDay(inv.period_start)} to ${calDay(inv.period_end)} · ${rides} ${rides === 1 ? 'ride' : 'rides'}`
  }
  return `${day(inv.issued_at)} · incl. GST ₹${rupees(inv.gst_total)}`
}

/**
 * The driver's GST tax invoices: one per ride-credit plan they bought, and one consolidated commission invoice per period. Tapping one opens
 * the PDF in a browser tab through a short-lived link (a tab cannot send the app's login), so nothing is downloaded or stored in the app.
 * Draws nothing until there is at least one invoice.
 */
export function InvoicesCard({ refreshKey }: { refreshKey: number }) {
  const [invoices, setInvoices] = useState<PackageInvoiceRow[]>([])
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => { fetchPackageInvoices().then(setInvoices).catch(() => undefined) }, [refreshKey])

  const open = useCallback(async (id: string) => {
    setOpening(id)
    try { await WebBrowser.openBrowserAsync(await fetchPackageInvoiceLink(id)) } catch { /* the row just stays tappable */ } finally { setOpening(null) }
  }, [])

  if (invoices.length === 0) return null
  const shown = invoices.slice(0, 6)
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Tax invoices</Text>
      {shown.map((inv, i) => (
        <Pressable
          key={inv.id}
          accessibilityRole="button"
          accessibilityLabel={`Open GST invoice ${inv.invoice_no}`}
          onPress={() => void open(inv.id)}
          style={[styles.row, i < shown.length - 1 ? styles.rowBorder : null]}
        >
          <View style={styles.icon}><Feather name="file-text" size={16} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{inv.invoice_no}</Text>
            <Text style={styles.muted} numberOfLines={2}>{subtitle(inv)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.amount}>₹{rupees(inv.total)}</Text>
            <Text style={styles.link}>{opening === inv.id ? 'Opening…' : 'View'}</Text>
          </View>
        </Pressable>
      ))}
      <Text style={styles.fine}>GST tax invoices for your ride-credit purchases and for the commission deducted from your wallet. Keep them for your records.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoLight },
  name: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold },
  muted: { ...typography.caption, color: colors.ink600 },
  amount: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  link: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold },
  fine: { ...typography.caption, color: colors.ink600, marginTop: spacing.sm, lineHeight: 18 },
})
