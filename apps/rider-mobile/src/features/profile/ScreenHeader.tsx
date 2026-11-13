import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text, font, h } from '@ocar/mobile-shared'
import { IconButton } from '@/components/ui'

// Back + title (+ optional right action) used by the pushed profile sub-screens.
export function ScreenHeader({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <IconButton icon="arrow-left" label="Back" onPress={onBack ?? (() => router.back())} />
      <Text style={styles.title}>{title}</Text>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  title: { fontFamily: font.b, fontSize: 20, color: h.ivory, flex: 1 },
})
