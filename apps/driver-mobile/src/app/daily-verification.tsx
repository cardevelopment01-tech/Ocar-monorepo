import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { submitVerification, type PickedPhoto } from '@/features/verification/api'

type Step = 'selfie' | 'plate'
type Stage = 'gate' | 'preview'

const STEP_CONFIG: Record<Step, { title: string; instruction: string; front: boolean }> = {
  selfie: { title: "Take today's selfie", instruction: 'Look straight at the camera', front: true },
  plate: { title: "Photograph your vehicle's number plate", instruction: 'Make sure the number plate is clearly readable', front: false },
}

export default function DailyVerificationScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [step, setStep] = useState<Step>('selfie')
  const [stage, setStage] = useState<Stage>('gate')
  const [selfie, setSelfie] = useState<PickedPhoto | null>(null)
  const [plate, setPlate] = useState<PickedPhoto | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const cfg = STEP_CONFIG[step]

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { setPermissionDenied(true); return }
    setPermissionDenied(false)
    const result = await ImagePicker.launchCameraAsync({
      cameraType: cfg.front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
      quality: 0.75,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    const photo: PickedPhoto = { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', fileSize: asset.fileSize ?? 0 }
    if (step === 'selfie') setSelfie(photo)
    else setPlate(photo)
    setStage('preview')
  }

  function retake() {
    if (step === 'selfie') setSelfie(null)
    else setPlate(null)
    setStage('gate')
  }

  async function handleNext() {
    if (step === 'selfie') {
      setStep('plate')
      setStage('gate')
      return
    }
    if (!selfie || !plate) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await submitVerification(selfie, plate)
      router.replace('/go-online/mode')
    } catch {
      setSubmitError('Something went wrong submitting your verification. Please try again.')
      setSubmitting(false)
    }
  }

  const currentPhoto = step === 'selfie' ? selfie : plate

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink600} />
        </Pressable>
        <Text style={styles.stepLabel}>{step === 'selfie' ? 'Step 1 of 2' : 'Step 2 of 2'}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{cfg.title}</Text>
        <Text style={styles.instruction}>{cfg.instruction}</Text>

        {stage === 'preview' && currentPhoto ? (
          <Image source={{ uri: currentPhoto.uri }} style={styles.preview} />
        ) : (
          <View style={styles.gateCard}>
            <View style={styles.iconCircle}>
              <Feather name="camera" size={28} color={colors.primary} />
            </View>
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

        {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {stage === 'preview' ? (
          <>
            <Pressable onPress={() => void handleNext()} disabled={submitting} style={[styles.primaryBtn, submitting ? styles.disabled : null]}>
              {submitting ? <ActivityIndicator color={colors.inkInverse} /> : (
                <Text style={styles.primaryText}>{step === 'selfie' ? 'Continue' : 'Submit'}</Text>
              )}
            </Pressable>
            <Pressable onPress={retake} disabled={submitting} style={styles.secondaryBtn}>
              <Feather name="refresh-cw" size={14} color={colors.ink600} />
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => void takePhoto()} style={styles.primaryBtn}>
            <Feather name="camera" size={16} color={colors.inkInverse} />
            <Text style={styles.primaryText}>Open Camera</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  backBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { ...typography.caption, color: colors.ink400, fontWeight: '700' },
  content: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { ...typography.headline, color: colors.ink900, fontWeight: '800' },
  instruction: { ...typography.body, color: colors.ink600, marginBottom: spacing.md },
  gateCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  iconCircle: { width: 64, height: 64, borderRadius: radii.full, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  permissionWarning: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.md },
  permissionText: { ...typography.caption, color: colors.error, flex: 1 },
  preview: { width: '100%', aspectRatio: 1, borderRadius: radii['2xl'] },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 8 },
  disabled: { opacity: 0.5 },
  primaryText: { ...typography.body, color: colors.inkInverse, fontWeight: '700' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 4, marginTop: spacing.xs },
  secondaryText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
})
