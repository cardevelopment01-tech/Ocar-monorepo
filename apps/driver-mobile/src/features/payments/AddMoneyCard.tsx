import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Button, Input, Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { MIN_TOPUP, MAX_TOPUP, topupAmountError } from './paymentMachine'

const CHIPS = [100, 200, 500, 1000]

export function AddMoneyCard({ busy, onPay }: { busy: boolean; onPay: (amount: number) => void }) {
  const [text, setText] = useState('500')
  const amount = Number(text)
  const error = text === '' ? null : topupAmountError(amount)
  const valid = text !== '' && error === null

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Add money</Text>
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
              <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>₹{c.toLocaleString('en-IN')}</Text>
            </Pressable>
          )
        })}
      </View>
      <Input
        label={`Amount (₹${MIN_TOPUP} – ₹${MAX_TOPUP.toLocaleString('en-IN')})`}
        value={text}
        onChangeText={(t) => setText(t.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        editable={!busy}
        {...(error ? { error } : {})}
      />
      <Button
        label={valid ? `Pay ₹${amount.toLocaleString('en-IN')}` : 'Enter an amount'}
        loading={busy}
        disabled={!valid}
        onPress={() => onPay(amount)}
      />
      <Text style={styles.note}>UPI, cards and net banking. Secured by PayU.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  title: { ...typography.body, color: colors.ink900, fontFamily: fonts.bold },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { ...typography.label, color: colors.ink900, fontFamily: fonts.semibold },
  chipTextOn: { color: colors.inkInverse },
  note: { ...typography.caption, color: colors.ink400, textAlign: 'center' },
})
