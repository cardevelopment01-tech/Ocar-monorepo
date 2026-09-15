import { StyleSheet, Text, View } from 'react-native'
import { Button, colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { teardownPushNotifications } from '@/services/notifications'

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clearAuth)

  async function handleLogout() {
    await teardownPushNotifications()
    clearAuth()
  }

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{user?.name ?? user?.phone}</Text>
      <Text style={styles.detail}>{user?.phone}</Text>
      <Text style={styles.detail}>{user?.email ?? 'No email on file'}</Text>
      <Button label="Log out" variant="secondary" onPress={handleLogout} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg, gap: spacing.sm },
  name: { ...typography.headline, color: colors.ink900 },
  detail: { ...typography.body, color: colors.ink600 },
})
