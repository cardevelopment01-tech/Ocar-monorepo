import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button, Input, colors, formatCurrency, spacing, typography } from '@ocar/mobile-shared'

export type CashCollectionCardProps = {
  expectedFare: number
  loading: boolean
  error: string | null
  onConfirmFull: () => void
  onPartialOrNotCollected: (input: { collectedAmount?: number; notCollected?: boolean; note: string }) => void
}

// Design review decision: pre-filled expected fare as the primary one-tap
// action ("Confirm ₹X collected"), with a secondary path for partial/not
// collected -- minimizes friction on the highest-money-handling moment of a
// shift, per the design subagent's top finding.
export function CashCollectionCard({
  expectedFare,
  loading,
  error,
  onConfirmFull,
  onPartialOrNotCollected,
}: CashCollectionCardProps) {
  const [showPartial, setShowPartial] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Collect cash</Text>
      <Text style={styles.fare}>{formatCurrency(expectedFare)}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!showPartial ? (
        <>
          <Button label={`Confirm ${formatCurrency(expectedFare)} collected`} loading={loading} onPress={onConfirmFull} />
          <Button label="Didn't collect / partial" variant="ghost" onPress={() => setShowPartial(true)} />
        </>
      ) : (
        <>
          <Input
            label="Amount collected (leave blank if none)"
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          <Input label="Note" value={note} onChangeText={setNote} placeholder="Why the amount differs" />
          <Button
            label="Submit"
            loading={loading}
            onPress={() =>
              onPartialOrNotCollected({
                ...(amount ? { collectedAmount: parseFloat(amount) } : { notCollected: true }),
                note,
              })
            }
          />
          <Button label="Cancel" variant="ghost" onPress={() => setShowPartial(false)} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { ...typography.title, color: colors.ink900 },
  fare: { ...typography.display, color: colors.ink900 },
  error: { ...typography.label, color: colors.error },
})
