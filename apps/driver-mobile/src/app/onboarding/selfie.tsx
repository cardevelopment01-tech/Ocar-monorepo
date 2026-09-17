import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { onboardingApi, type PickedFile } from '@/features/onboarding/api'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'

type Stage = 'gate' | 'preview' | 'submitting'

export default function ReferenceSelfieScreen() {
  const router = useRouter()
  const updateDriver = useAuthStore((s) => s.updateDriver)

  const [stage, setStage] = useState<Stage>('gate')
  const [photo, setPhoto] = useState<PickedFile | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [submitError, setSubmitError] = useState('')

  async function takeSelfie() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { setPermissionDenied(true); return }
    setPermissionDenied(false)
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.75,
      allowsEditing: true,
      aspect: [1, 1],
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', fileSize: asset.fileSize ?? 0 })
    setStage('preview')
  }

  async function handleSubmit() {
    if (!photo) return
    setStage('submitting')
    setSubmitError('')
    try {
      await onboardingApi.uploadDriverDoc(photo, 'profile_photo')
      await onboardingApi.submitApplication()
      updateDriver({ onboarding_step: 'pending_review', status: 'pending_approval' })
      router.replace('/onboarding/pending-review')
    } catch {
      setSubmitError('Something went wrong submitting your application. Please try again.')
      setStage('preview')
    }
  }

  const footer = stage === 'preview' ? (
    <>
      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
      <Pressable onPress={() => void handleSubmit()} style={styles.primaryBtn}>
        <Text style={styles.primaryText}>Submit Application</Text>
      </Pressable>
      <Pressable onPress={() => { setPhoto(null); void takeSelfie() }} style={styles.secondaryBtn}>
        <Feather name="refresh-cw" size={14} color={colors.ink600} />
        <Text style={styles.secondaryText}>Retake</Text>
      </Pressable>
    </>
  ) : stage === 'submitting' ? (
    <View style={styles.submittingRow}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.submittingText}>Submitting…</Text>
    </View>
  ) : (
    <Pressable onPress={() => void takeSelfie()} style={styles.primaryBtn}>
      <Feather name="camera" size={16} color={colors.inkInverse} />
      <Text style={styles.primaryText}>Open Camera</Text>
    </Pressable>
  )

  return (
    <OnboardingShell stepIndex={3} title="Reference Selfie" footer={footer}>
      {stage === 'preview' && photo ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: photo.uri }} style={styles.previewImage} />
        </View>
      ) : (
        <View style={styles.gateCard}>
          <View style={styles.iconCircle}>
            <Feather name="camera" size={28} color={colors.primary} />
          </View>
          <Text style={styles.gateTitle}>One last step</Text>
          <Text style={styles.gateBody}>
            Take a clear selfie in good lighting. This helps riders recognize you and keeps the
            platform safe for everyone.
          </Text>
          {permissionDenied ? (
            <View style={styles.permissionWarning}>
              <Feather name="lock" size={13} color={colors.error} />
              <Text style={styles.permissionText}>
                Camera access was denied. Enable it for Ocar Driver in your phone's Settings, then try again.
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </OnboardingShell>
  )
}

const styles = StyleSheet.create({
  gateCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg, alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  iconCircle: { width: 64, height: 64, borderRadius: radii.full, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  gateTitle: { ...typography.title, color: colors.ink900, fontWeight: '800' },
  gateBody: { ...typography.body, color: colors.ink600, textAlign: 'center' },
  permissionWarning: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.sm },
  permissionText: { ...typography.caption, color: colors.error, flex: 1 },
  previewWrap: { alignItems: 'center' },
  previewImage: { width: 220, height: 220, borderRadius: radii['2xl'] },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center', marginBottom: spacing.xs },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 8 },
  primaryText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 4, marginTop: spacing.xs },
  secondaryText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
  submittingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  submittingText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
})
