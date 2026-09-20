import { useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { getInfoAsync } from 'expo-file-system/legacy'
import { Feather } from '@expo/vector-icons'
import { Button, colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { onboardingApi, type PickedFile } from '@/features/onboarding/api'
import { OnboardingShell } from '@/features/onboarding/components/OnboardingShell'
import { OvalOverlay } from '@/components/camera/OvalOverlay'

type Stage = 'gate' | 'camera' | 'preview' | 'submitting'

export default function ReferenceSelfieScreen() {
  const router = useRouter()
  const updateDriver = useAuthStore((s) => s.updateDriver)
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const cameraRef = useRef<CameraView>(null)

  const [stage, setStage] = useState<Stage>('gate')
  const [photo, setPhoto] = useState<PickedFile | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [permission, requestPermission] = useCameraPermissions()

  async function openCamera() {
    const result = permission?.granted ? permission : await requestPermission()
    if (!result.granted) { setPermissionDenied(true); return }
    setPermissionDenied(false)
    setCameraReady(false)
    setStage('camera')
  }

  async function capture() {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.75 })
      if (!shot) return
      const info = await getInfoAsync(shot.uri)
      setPhoto({ uri: shot.uri, mimeType: 'image/jpeg', fileSize: info.exists ? (info.size ?? 0) : 0 })
      setStage('preview')
    } finally {
      setCapturing(false)
    }
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

  if (stage === 'camera') {
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="front"
          onCameraReady={() => setCameraReady(true)}
        />

        {!cameraReady ? (
          <Animated.View exiting={FadeOut.duration(250)} style={[StyleSheet.absoluteFill, styles.loadingVeil]}>
            <ActivityIndicator color={colors.inkInverse} size="large" />
          </Animated.View>
        ) : null}

        <OvalOverlay screenWidth={screenWidth} screenHeight={screenHeight} />

        <View style={styles.cameraHeader}>
          <Pressable
            onPress={() => setStage('gate')}
            style={({ pressed }) => [styles.cameraBackBtn, pressed ? styles.pressedScale : null]}
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Feather name="arrow-left" size={18} color={colors.inkInverse} />
          </Pressable>
        </View>

        {cameraReady ? (
          <Animated.View entering={FadeIn.delay(400).duration(250)} style={styles.chipTop} pointerEvents="none">
            <Text style={styles.chipTopText}>Position your face in the oval</Text>
          </Animated.View>
        ) : null}
        {cameraReady ? (
          <Animated.View entering={FadeIn.delay(500).duration(250)} style={styles.chipBottom} pointerEvents="none">
            <Text style={styles.chipBottomText}>Look straight  ·  Good lighting  ·  Clear view of face</Text>
          </Animated.View>
        ) : null}

        <View style={styles.shutterRow}>
          <Pressable onPress={() => void capture()} disabled={!cameraReady || capturing} style={styles.shutterBtn} accessibilityLabel="Capture selfie">
            <View style={styles.shutterRing} />
            <View style={styles.shutterDisc} />
          </Pressable>
          <Text style={styles.shutterHint}>Tap to capture</Text>
        </View>
      </View>
    )
  }

  const footer = stage === 'preview' ? (
    <>
      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
      <Button label="Submit Application" onPress={() => void handleSubmit()} />
      <Button label="Retake" variant="ghost" icon="refresh-cw" onPress={() => { setPhoto(null); void openCamera() }} />
    </>
  ) : stage === 'submitting' ? (
    <View style={styles.submittingRow}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.submittingText}>Submitting…</Text>
    </View>
  ) : (
    <Button label="Open Camera" icon="camera" onPress={() => void openCamera()} />
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
  // headline, not title -- this gate card is the only content on the screen
  // and should read with the same weight as OnboardingShell's own step title,
  // not a smaller card-subsection size. 700 is the heaviest loaded weight.
  gateTitle: { ...typography.headline, color: colors.ink900, fontWeight: '700' },
  gateBody: { ...typography.body, color: colors.ink600, textAlign: 'center' },
  permissionWarning: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.sm },
  permissionText: { ...typography.caption, color: colors.error, flex: 1 },
  previewWrap: { alignItems: 'center' },
  previewImage: { width: 220, height: 220, borderRadius: radii['2xl'] },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center', marginBottom: spacing.xs },
  submittingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  submittingText: { ...typography.body, color: colors.ink600, fontWeight: '600' },
  pressedScale: { transform: [{ scale: 0.97 }] },

  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  loadingVeil: { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  cameraHeader: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.md, zIndex: 15 },
  cameraBackBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  chipTop: { position: 'absolute', top: spacing.xl + spacing.xl + spacing.md, left: 0, right: 0, alignItems: 'center', zIndex: 15 },
  chipTopText: { ...typography.caption, color: colors.inkInverse, fontWeight: '700', letterSpacing: 0.3, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.full, overflow: 'hidden' },
  chipBottom: { position: 'absolute', bottom: 180, left: spacing.lg, right: spacing.lg, alignItems: 'center', zIndex: 15 },
  chipBottomText: { ...typography.caption, color: 'rgba(255,255,255,0.9)', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radii.full, overflow: 'hidden' },
  shutterRow: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#000000', paddingTop: spacing.lg, paddingBottom: spacing.xl + spacing.sm, alignItems: 'center', gap: spacing.sm },
  shutterBtn: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  shutterDisc: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.inkInverse },
  shutterHint: { ...typography.caption, color: 'rgba(255,255,255,0.7)' },
})
