import { useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather } from '@expo/vector-icons'
import { Button, Text, colors, fonts, radii, shadows, spacing, typography } from '@ocar/mobile-shared'
import { MIN_TOPUP, MAX_TOPUP, topupAmountError } from './paymentMachine'
import type { PayMode } from './payuSdk'

const CHIPS = [100, 200, 500, 1000]
const METHODS: Array<{ mode: PayMode; icon: React.ComponentProps<typeof Feather>['name']; label: string; sub: string }> = [
  { mode: 'UPI', icon: 'smartphone', label: 'UPI', sub: 'Fastest' },
  { mode: 'CARD', icon: 'credit-card', label: 'Card', sub: 'Debit / credit' },
  { mode: 'NB', icon: 'globe', label: 'Net banking', sub: 'All banks' },
  { mode: 'WALLET', icon: 'briefcase', label: 'Wallet', sub: 'Paytm & more' },
]

const inr = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 0 })

// Premium "Add money" panel: a big amount hero, quick-add chips, a live "balance after"
// line, accepted methods and a single obvious pay button. The payment sheet itself is
// PayU's native UI (themed in payuSdk.ts); everything the driver sees before it is ours.
export function AddMoneyCard({ busy, balance, onPay }: { busy: boolean; balance: number; onPay: (amount: number, mode: PayMode) => void }) {
  const [text, setText] = useState('500')
  const [mode, setMode] = useState<PayMode>('UPI')
  const [focused, setFocused] = useState(false)
  const amount = Number(text)
  const error = text === '' ? null : topupAmountError(amount)
  const valid = text !== '' && error === null

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Add money</Text>
        <View style={styles.secure}>
          <Feather name="lock" size={11} color={colors.success} />
          <Text style={styles.secureText}>Secure</Text>
        </View>
      </View>

      <LinearGradient
        colors={['#F3FBFC', '#E6F5F7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, focused ? styles.heroFocused : null, error ? styles.heroError : null]}
      >
        <Text style={styles.heroLabel}>Amount</Text>
        <View style={styles.amountRow}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            value={text}
            onChangeText={(t) => setText(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            editable={!busy}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="0"
            placeholderTextColor={colors.ink400}
            selectionColor={colors.primary}
            cursorColor={colors.primary}
            style={styles.amountInput}
            accessibilityLabel="Amount in rupees"
          />
        </View>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.hint}>
            {valid ? `Balance after: ₹${inr(balance + amount)}` : `Min ₹${inr(MIN_TOPUP)} · Max ₹${inr(MAX_TOPUP)}`}
          </Text>
        )}
      </LinearGradient>

      <View style={styles.chips}>
        {CHIPS.map((c) => {
          const on = amount === c
          return (
            <Pressable
              key={c}
              disabled={busy}
              onPress={() => setText(String(c))}
              style={[styles.chip, on ? styles.chipOn : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: busy }}
            >
              <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>+₹{inr(c)}</Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.sectionLabel}>Pay with</Text>
      <View style={styles.methods}>
        {METHODS.map((m) => {
          const on = mode === m.mode
          return (
            <Pressable
              key={m.mode}
              disabled={busy}
              onPress={() => setMode(m.mode)}
              style={[styles.method, on ? styles.methodOn : null]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }}
              accessibilityLabel={`${m.label}, ${m.sub}`}
            >
              <View style={[styles.methodIcon, on ? styles.methodIconOn : null]}>
                <Feather name={m.icon} size={18} color={on ? colors.inkInverse : colors.ink600} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodText} numberOfLines={1}>{m.label}</Text>
                <Text style={styles.methodSub} numberOfLines={1}>{m.sub}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>

      <Button
        label={valid ? `Pay ₹${inr(amount)} with ${METHODS.find((m) => m.mode === mode)?.label ?? 'PayU'}` : 'Enter an amount'}
        icon="lock"
        loading={busy}
        disabled={!valid}
        onPress={() => onPay(amount, mode)}
      />
      <Text style={styles.note}>Payments are processed by PayU. Your card or UPI details never touch Ocar.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii['2xl'], padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadows.card },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.full },
  secureText: { ...typography.caption, color: colors.success, fontFamily: fonts.semibold },
  hero: { borderRadius: radii.xl, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: 'transparent' },
  heroFocused: { borderColor: colors.primary },
  heroError: { borderColor: colors.error },
  heroLabel: { ...typography.label, color: colors.ink400, fontFamily: fonts.semibold },
  amountRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  rupee: { fontSize: 34, fontFamily: fonts.bold, color: colors.ink600, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 44, lineHeight: 54, fontFamily: fonts.bold, color: colors.ink900, padding: 0 },
  hint: { ...typography.caption, color: colors.ink600, marginTop: 4 },
  error: { ...typography.caption, color: colors.error, marginTop: 4, fontFamily: fonts.semibold },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { ...typography.label, color: colors.ink900, fontFamily: fonts.semibold },
  chipTextOn: { color: colors.inkInverse },
  sectionLabel: { ...typography.label, color: colors.ink400, fontFamily: fonts.semibold, marginBottom: -4 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  method: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 2, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  methodOn: { borderColor: colors.primary, backgroundColor: '#F3FBFC' },
  methodIcon: { width: 34, height: 34, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  methodIconOn: { backgroundColor: colors.primary },
  methodText: { ...typography.label, color: colors.ink900, fontFamily: fonts.semibold },
  methodSub: { ...typography.caption, color: colors.ink400 },
  note: { ...typography.caption, color: colors.ink400, textAlign: 'center' },
})
