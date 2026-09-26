import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, colors, typography, Text } from '@ocar/mobile-shared'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'
import { DocumentsFields } from '@/features/onboarding/components/DocumentsFields'
import { useDocumentsForm } from '@/features/onboarding/useDocumentsForm'
import { DRIVER_DOC_GROUPS, VEHICLE_DOC_GROUPS } from '@/features/onboarding/constants'

export default function DocumentsScreen() {
  const router = useRouter()
  const form = useDocumentsForm()

  if (form.isFetching) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  const requiredExpiryGroups = [...DRIVER_DOC_GROUPS, ...VEHICLE_DOC_GROUPS].filter((g) => g.required && g.hasExpiry && g.expiryRequired)
  const missingHint = !form.identityFilled
    ? 'Enter your licence and Aadhaar numbers'
    : !form.allDocsUploaded
      ? 'Upload all required documents to continue'
      : !form.allExpiriesFilled
        ? `Set expiry date for: ${requiredExpiryGroups.filter((g) => !form.validUntil[g.groupKey]).map((g) => g.label).join(', ')}`
        : ''

  async function handleContinue() {
    if (!(await form.saveIdentityIfNeeded())) return
    router.push('/onboarding/selfie')
  }

  const footer = (
    <>
      {!form.canContinue && missingHint ? <Text style={styles.hint}>{missingHint}</Text> : null}
      <Button label="Continue to Selfie" onPress={() => void handleContinue()} loading={form.isSaving} disabled={!form.canContinue} />
    </>
  )

  return (
    <OnboardingShell stepIndex={2} title="Documents" footer={footer}>
      <DocumentsFields form={form} />
    </OnboardingShell>
  )
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hint: { ...typography.caption, color: colors.ink400, textAlign: 'center', marginBottom: 4 },
})
