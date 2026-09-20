import { useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { getInfoAsync } from 'expo-file-system/legacy'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '@ocar/mobile-shared'
import { OvalOverlay } from '@/components/camera/OvalOverlay'
import { RectOverlay } from '@/components/camera/RectOverlay'
import { submitVerification, type PickedPhoto } from '@/features/verification/api'

type Step = 'selfie' | 'plate'
type Stage = 'gate' | 'camera' | 'preview'

const STEP_CONFIG: Record<Step, { title: string; instruction: string; cameraHint: string; front: boolean }> = {
  selfie: {
    title: "Take today's selfie",
    instruction: 'Look straight at the camera',
    cameraHint: 'Position your face in the oval',
    front: true,
  },
  plate: {
    title: "Photograph your vehicle's number plate",
    instruction: 'Make sure the number plate is clearly readable',
    cameraHint: 'Fit the number plate inside the frame',
    front: false,
  },
}

export default function DailyVerificationScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const cameraRef = useRef<CameraView>(null)

  const [step, setStep] = useState<Step>('selfie')
  const [stage, setStage] = useState<Stage>('gate')
  const [selfie, setSelfie] = useState<PickedPhoto | null>(null)
  const [plate, setPlate] = useState<PickedPhoto | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [permission, requestPermission] = useCameraPermissions()

  const cfg = STEP_CONFIG[step]

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
      // asset.fileSize is unreliable after a quality re-encode -- see
      // DocSlot.tsx's pickFrom for why this must read the real file size.
      const info = await getInfoAsync(shot.uri)
      const photo: PickedPhoto = { uri: shot.uri, mimeType: 'image/jpeg', fileSize: info.exists ? (info.size ?? 0) : 0 }
      if (step === 'selfie') setSelfie(photo)
      else setPlate(photo)
      setStage('preview')
    } finally {
      setCapturing(false)
    }
  }

  function retake() {
    if (step === 'selfie') setSelfie(null)
    else setPlate(null)
    void openCamera()
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

  if (stage === 'camera') {
    return (
      <View style={styles.cameraScreen}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={cfg.front ? 'front' : 'back'}
          onCameraReady={() => setCameraReady(true)}
        />

        {!cameraReady ? (
          <Animated.View exiting={FadeOut.duration(250)} style={[StyleSheet.absoluteFill, styles.loadingVeil]}>
            <ActivityIndicator color={colors.inkInverse} size="large" />
          </Animated.View>
        ) : null}

        {cfg.front ? (
          <OvalOverlay screenWidth={screenWidth} screenHeight={screenHeight} />
        ) : (
          <RectOverlay screenWidth={screenWidth} screenHeight={screenHeight} />
        )}

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
            <Text style={styles.chipTopText}>{cfg.cameraHint}</Text>
          </Animated.View>
        ) : null}

        <View style={styles.shutterRow}>
          <Pressable onPress={() => void capture()} disabled={!cameraReady || capturing} style={styles.shutterBtn} accessibilityLabel={`Capture ${step}`}>
            <View style={styles.shutterRing} />
            <View style={styles.shutterDisc} />
          </Pressable>
          <Text style={styles.shutterHint}>Tap to capture</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
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
          <Pressable onPress={() => void openCamera()} style={styles.primaryBtn}>
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

  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  loadingVeil: { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  cameraHeader: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.md, zIndex: 15 },
  cameraBackBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  pressedScale: { transform: [{ scale: 0.97 }] },
  chipTop: { position: 'absolute', top: spacing.xl + spacing.xl + spacing.md, left: 0, right: 0, alignItems: 'center', zIndex: 15 },
  chipTopText: { ...typography.caption, color: colors.inkInverse, fontWeight: '700', letterSpacing: 0.3, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.full, overflow: 'hidden' },
  shutterRow: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#000000', paddingTop: spacing.lg, paddingBottom: spacing.xl + spacing.sm, alignItems: 'center', gap: spacing.sm },
  shutterBtn: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  shutterDisc: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.inkInverse },
  shutterHint: { ...typography.caption, color: 'rgba(255,255,255,0.7)' },
})
