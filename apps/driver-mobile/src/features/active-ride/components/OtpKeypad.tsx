import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, Text } from '@ocar/mobile-shared'

const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', 'back']] as const

/** In-app number pad so the system keyboard never covers the sheet. Key height is passed in so the
 *  pad scales with the device height. */
export function OtpKeypad({ onDigit, onBackspace, keyHeight, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; keyHeight: number; disabled?: boolean }) {
  return (
    <View style={styles.pad} accessibilityLabel="Number pad">
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((k, c) => {
            if (k === '') return <View key={c} style={styles.key} />
            const isBack = k === 'back'
            return (
              <Pressable
                key={c}
                disabled={disabled}
                onPress={() => (isBack ? onBackspace() : onDigit(k))}
                accessibilityRole="button"
                accessibilityLabel={isBack ? 'Delete' : k}
                style={({ pressed }) => [styles.key, { height: keyHeight }, pressed && styles.pressed]}
              >
                {isBack ? <Feather name="delete" size={22} color={colors.ink900} /> : <Text style={styles.digit} maxFontSizeMultiplier={1.2}>{k}</Text>}
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  pad: { gap: 4 },
  row: { flexDirection: 'row', gap: 4 },
  key: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  pressed: { backgroundColor: 'rgba(20,23,26,0.07)' },
  digit: { fontFamily: fonts.semibold, fontSize: 26, color: colors.ink900 },
})
