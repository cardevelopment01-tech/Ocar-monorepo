import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Text, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'

// Back + title (+ optional right action) used by the pushed profile sub-screens.
export function ScreenHeader({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={onBack ?? (() => router.back())} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Feather name="arrow-left" size={18} color={colors.ink900} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, flex: 1 },
})
