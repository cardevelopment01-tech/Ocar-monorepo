import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Constants from 'expo-constants'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { getInfoAsync } from 'expo-file-system/legacy'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography, fonts, Text, getApiErrorMessage, PRIVACY_URL } from '@ocar/mobile-shared'
import { OvalOverlay } from '@/components/camera/OvalOverlay'
import { RectOverlay } from '@/components/camera/RectOverlay'
import {
  acceptVerificationConsent, fetchVerificationStatus, submitVerification, type PickedPhoto,
} from '@/features/verification/api'
import { parseVerificationFailure, retakeLine, retakePlan } from '@/features/verification/errors'

type Step = 'selfie' | 'plate'
type Stage = 'gate' | 'camera' | 'preview'

const SUPPORT_EMAIL = 'grievance@ocarindia.com'
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=Ocar%20driver%20support`
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0'

// Shown when the server refuses to go on: scores and match reasons are never shown, only what the driver can do next.
type Blocked = { attemptsLeft: number; underReview: boolean }

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
  // "Quick safety check" mode (offline after a few rides / a long ride) and the one-time consent card.
  const [reverify, setReverify] = useState(false)
  const [needsConsent, setNeedsConsent] = useState(false)
  const [consentBusy, setConsentBusy] = useState(false)
  const [retakeNotes, setRetakeNotes] = useState<Partial<Record<Step, string>>>({})
  const [retakeOnly, setRetakeOnly] = useState<Step | null>(null)
  const [blocked, setBlocked] = useState<Blocked | null>(null)

  useEffect(() => {
    // A failed lookup leaves both off: the screen then behaves exactly like the plain daily check.
    fetchVerificationStatus()
      .then((s) => { setReverify(!!s.reverify); setNeedsConsent(!!s.consentRequired) })
      .catch(() => {})
  }, [])

  async function agree() {
    setConsentBusy(true)
    try {
      await acceptVerificationConsent(APP_VERSION)
      setNeedsConsent(false)
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, "Couldn't save that. Please try again."))
    } finally {
      setConsentBusy(false)
    }
  }

  const openSupport = () => void Linking.openURL(SUPPORT_MAILTO).catch(() => {})

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
      const photo: PickedPhoto = { uri: shot.uri, mimeType: 'image/jpeg', fileSize: info.exists ? (info.size ?? 0) : 0, width: shot.width, height: shot.height }
      if (step === 'selfie') setSelfie(photo)
      else setPlate(photo)
      setRetakeNotes((n) => { const next = { ...n }; delete next[step]; return next })
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

  // The last step submits. So does a retaken selfie when the plate photo was kept from the first attempt.
  const submitsNow = step === 'plate' || (retakeOnly === 'selfie' && !!plate)

  async function handleNext() {
    if (!submitsNow) {
      setStep('plate')
      setStage(plate ? 'preview' : 'gate')
      return
    }
    if (!selfie || !plate) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await submitVerification(selfie, plate)
      router.replace('/go-online/mode')
    } catch (err) {
      setSubmitting(false)
      const failure = parseVerificationFailure(err)
      if (failure?.kind === 'retake') {
        // Only the unusable photo(s) are cleared and reopened; the other one is kept (design review DD2).
        const plan = retakePlan(failure)
        const notes: Partial<Record<Step, string>> = {}
        if (failure.selfie) { notes.selfie = retakeLine(failure.selfie); setSelfie(null) }
        if (failure.plate) { notes.plate = retakeLine(failure.plate); setPlate(null) }
        setRetakeNotes(notes)
        setRetakeOnly(plan.only)
        setStep(plan.first)
        setStage('gate')
        return
      }
      if (failure?.kind === 'failed') {
        // Neutral wording, tries left, and a way to reach support. Never why it failed.
        setBlocked({ attemptsLeft: failure.attemptsLeft, underReview: failure.attemptsLeft === 0 })
        setSelfie(null)
        setRetakeOnly('selfie')
        setStep('selfie')
        setStage('gate')
        return
      }
      if (failure?.kind === 'under_review') {
        setBlocked({ attemptsLeft: 0, underReview: true })
        return
      }
      setSubmitError(getApiErrorMessage(err, 'Something went wrong submitting your verification. Please try again.'))
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

        <View style={[styles.shutterRow, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.lg }]}>
          <Pressable onPress={() => void capture()} disabled={!cameraReady || capturing} style={styles.shutterBtn} accessibilityLabel={`Capture ${step}`}>
            <View style={styles.shutterRing} />
            <View style={styles.shutterDisc} />
          </Pressable>
          <Text style={styles.shutterHint}>Tap to capture</Text>
        </View>
      </View>
    )
  }

  // One-time consent card, shown before the first verification camera (design review DD4). Declining keeps the driver
  // offline with a way to reach support. The legal wording is for the owner to confirm before flag mode goes live.
  if (needsConsent) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
            <Feather name="arrow-left" size={20} color={colors.ink600} />
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={styles.title}>Before we start</Text>
          <Text style={styles.instruction}>To keep every account safe, Ocar checks that the person driving matches the account.</Text>
          <View style={styles.consentCard}>
            <ConsentLine icon="camera" text="We compare your selfie with your onboarding photo, and your number plate photo with your registered vehicle." />
            <ConsentLine icon="shield" text="This is only used to keep your account and your passengers safe." />
            <ConsentLine icon="clock" text="Your photos are kept only as long as these checks need them." />
          </View>
          <Text style={styles.linkText} onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
            Read the Privacy Policy
          </Text>
          {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Pressable onPress={() => void agree()} disabled={consentBusy} style={[styles.primaryBtn, consentBusy ? styles.disabled : null]} accessibilityRole="button">
            {consentBusy ? <ActivityIndicator color={colors.inkInverse} /> : <Text style={styles.primaryText}>Agree and continue</Text>}
          </Pressable>
          <Pressable onPress={openSupport} style={styles.secondaryBtn} accessibilityRole="button">
            <Text style={styles.secondaryText}>Not now, contact support</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  const noteForStep = retakeNotes[step]
  // Out of tries: nothing more to capture, only a way to reach support.
  const outOfTries = blocked?.underReview === true

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back() }} style={styles.backBtn} accessibilityLabel="Go back" hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink600} />
        </Pressable>
        <Text style={styles.stepLabel}>{step === 'selfie' ? 'Step 1 of 2' : 'Step 2 of 2'}</Text>
      </View>

      <View style={styles.content}>
        {reverify ? (
          <View style={styles.reverifyCard}>
            <Text style={styles.reverifyTitle}>Quick safety check</Text>
            <Text style={styles.reverifyLine}>Take a selfie and a photo of your number plate to go online</Text>
          </View>
        ) : null}
        <Text style={styles.title}>{cfg.title}</Text>
        <Text style={styles.instruction}>{cfg.instruction}</Text>

        {noteForStep ? (
          <View style={styles.retakeNote} accessibilityRole="alert">
            <Feather name="alert-circle" size={14} color={colors.error} />
            <Text style={styles.retakeNoteText}>{noteForStep}</Text>
          </View>
        ) : null}

        {blocked ? (
          <View style={styles.retakeNote} accessibilityRole="alert">
            <Feather name="alert-circle" size={14} color={colors.error} />
            <Text style={styles.retakeNoteText}>
              {blocked.underReview
                ? 'An admin will review this. Contact support if you need help going online.'
                : `We couldn't verify this photo. ${blocked.attemptsLeft} ${blocked.attemptsLeft === 1 ? 'try' : 'tries'} left.`}
            </Text>
          </View>
        ) : null}

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
        {outOfTries ? (
          <Pressable onPress={openSupport} style={styles.primaryBtn} accessibilityRole="button">
            <Feather name="mail" size={16} color={colors.inkInverse} />
            <Text style={styles.primaryText}>Contact support</Text>
          </Pressable>
        ) : stage === 'preview' ? (
          <>
            <Pressable onPress={() => void handleNext()} disabled={submitting} style={[styles.primaryBtn, submitting ? styles.disabled : null]}>
              {submitting ? (
                <View style={styles.checkingRow}>
                  <ActivityIndicator color={colors.inkInverse} />
                  <Text style={styles.primaryText}>Checking your photo</Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>{submitsNow ? 'Submit' : 'Continue'}</Text>
              )}
            </Pressable>
            <Pressable onPress={retake} disabled={submitting} style={styles.secondaryBtn}>
              <Feather name="refresh-cw" size={14} color={colors.ink600} />
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
            {blocked ? (
              <Pressable onPress={openSupport} style={styles.secondaryBtn} accessibilityRole="button">
                <Text style={styles.secondaryText}>Contact support</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Pressable onPress={() => void openCamera()} style={styles.primaryBtn}>
              <Feather name="camera" size={16} color={colors.inkInverse} />
              <Text style={styles.primaryText}>Open Camera</Text>
            </Pressable>
            {blocked ? (
              <Pressable onPress={openSupport} style={styles.secondaryBtn} accessibilityRole="button">
                <Text style={styles.secondaryText}>Contact support</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  )
}

function ConsentLine({ icon, text }: { icon: 'camera' | 'shield' | 'clock'; text: string }) {
  return (
    <View style={styles.consentLine}>
      <Feather name={icon} size={16} color={colors.primary} />
      <Text style={styles.consentText}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  backBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { ...typography.caption, color: colors.ink400, fontFamily: fonts.bold },
  content: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { ...typography.headline, color: colors.ink900, fontFamily: fonts.bold },
  instruction: { ...typography.body, color: colors.ink600, marginBottom: spacing.md },
  gateCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  iconCircle: { width: 64, height: 64, borderRadius: radii.full, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  permissionWarning: { flexDirection: 'row', gap: spacing.xs, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm, marginTop: spacing.md },
  permissionText: { ...typography.caption, color: colors.error, flex: 1 },
  preview: { width: '100%', aspectRatio: 1, borderRadius: radii['2xl'] },
  errorText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  reverifyCard: { backgroundColor: colors.primarySubtle, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs / 2, marginBottom: spacing.xs },
  reverifyTitle: { ...typography.body, color: colors.primary, fontFamily: fonts.bold },
  reverifyLine: { ...typography.caption, color: colors.ink600 },
  retakeNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.errorLight, borderRadius: radii.md, padding: spacing.sm },
  retakeNoteText: { ...typography.caption, color: colors.error, flex: 1, fontFamily: fonts.semibold },
  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  consentCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  consentLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  consentText: { ...typography.body, color: colors.ink900, flex: 1 },
  linkText: { ...typography.caption, color: colors.primary, fontFamily: fonts.semibold, textDecorationLine: 'underline', paddingVertical: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.primary, borderRadius: radii.lg, paddingVertical: spacing.sm + 8 },
  disabled: { opacity: 0.5 },
  primaryText: { ...typography.body, color: colors.inkInverse, fontFamily: fonts.bold },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 4, marginTop: spacing.xs },
  secondaryText: { ...typography.body, color: colors.ink600, fontFamily: fonts.semibold },

  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  loadingVeil: { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  cameraHeader: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.md, zIndex: 15 },
  cameraBackBtn: { width: 44, height: 44, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  pressedScale: { transform: [{ scale: 0.97 }] },
  chipTop: { position: 'absolute', top: spacing.xl + spacing.xl + spacing.md, left: 0, right: 0, alignItems: 'center', zIndex: 15 },
  chipTopText: { ...typography.caption, color: colors.inkInverse, fontFamily: fonts.bold, letterSpacing: 0.3, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.full, overflow: 'hidden' },
  shutterRow: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#000000', paddingTop: spacing.lg, paddingBottom: spacing.xl + spacing.sm, alignItems: 'center', gap: spacing.sm },
  shutterBtn: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  shutterDisc: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.inkInverse },
  shutterHint: { ...typography.caption, color: 'rgba(255,255,255,0.7)' },
})
