import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Button, Input, colors, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { updateProfile } from '@/features/profile/api'

// Mirrors apps/user/app/onboarding/page.tsx: a new rider (isNew, or no name on
// the account yet) lands here straight after OTP verify instead of home --
// web collects the name here, mobile never did, so a rider's name was never
// actually captured anywhere in this app.
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const updateUser = useAuthStore((s) => s.updateUser)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isValid = fullName.trim().length >= 2

  async function handleSubmit() {
    if (!isValid || loading) return
    setError('')
    setLoading(true)
    try {
      const data: { full_name: string; email?: string } = { full_name: fullName.trim() }
      if (email.trim()) data.email = email.trim()
      const profile = await updateProfile(data)
      updateUser({ name: profile.name, email: profile.email })
      router.replace('/(tabs)/home')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    // KeyboardAvoidingView's Android "height" behavior relies on the same
    // root-view-resize detection edgeToEdgeEnabled breaks (see phone.tsx's
    // HERO_HEIGHT comment) -- it does nothing here. Content is already
    // top-anchored with no big hero image pushing it down, so this screen
    // doesn't hit that bug's severe form, but a plain ScrollView still gives
    // a manual-scroll safety net for the keyboard-open case.
    <ScrollView
      style={[styles.container]}
      contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.title}>Almost there!</Text>
        <Text style={styles.subtitle}>Just tell us your name</Text>
      </View>

      <View style={styles.form}>
        <Input
          value={fullName}
          onChangeText={(t) => { setFullName(t); setError('') }}
          placeholder="Your full name"
          accessibilityLabel="Full name"
          autoFocus
        />
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="Email address (optional)"
          keyboardType="email-address"
          accessibilityLabel="Email address"
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label="Get Started" onPress={handleSubmit} loading={loading} disabled={!isValid} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  title: { ...typography.display, color: colors.ink900 },
  subtitle: { ...typography.body, color: colors.ink600 },
  form: { gap: spacing.md },
  error: { ...typography.label, color: colors.error },
})
