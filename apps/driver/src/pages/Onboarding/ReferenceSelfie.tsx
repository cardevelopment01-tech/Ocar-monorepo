import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Camera, Lock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { onboardingApi } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'
import OcarSpinner from '@/components/ui/OcarSpinner'

type Stage = 'camera' | 'preview' | 'submitting'

const STEPS = ['personal_info', 'vehicle_info', 'documents', 'selfie']
const STEP_IDX = 3

type BrowserPermissionGuide = { browserLabel: string; steps: string[] }

const RELOAD_STEP = 'Reload this page'

function getBrowserPermissionGuide(): BrowserPermissionGuide {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)

  if (isIOS) {
    return {
      browserLabel: 'Safari',
      steps: [
        'Open the Settings app on your device',
        'Scroll down and tap Safari',
        'Tap Camera, then choose Allow',
        RELOAD_STEP,
      ],
    }
  }
  if (/SamsungBrowser/.test(ua)) {
    return {
      browserLabel: 'Samsung Internet',
      steps: [
        'Tap the lock icon next to the address bar',
        'Tap Permissions → Camera',
        'Select Allow',
        RELOAD_STEP,
      ],
    }
  }
  if (/Firefox/.test(ua)) {
    return {
      browserLabel: 'Firefox',
      steps: [
        'Tap the lock icon next to the address bar',
        'Tap Permissions',
        'Turn Camera access on',
        RELOAD_STEP,
      ],
    }
  }
  if (/Edg\//.test(ua)) {
    return {
      browserLabel: 'Edge',
      steps: [
        'Tap the lock icon next to the address bar',
        'Tap Permissions for this site',
        'Set Camera to Allow',
        RELOAD_STEP,
      ],
    }
  }
  // Chrome, Chrome on Android, and other Chromium-based browsers (default)
  return {
    browserLabel: 'Chrome',
    steps: [
      'Tap the lock icon next to the address bar',
      'Tap Permissions',
      'Set Camera to Allow',
      RELOAD_STEP,
    ],
  }
}

export default function ReferenceSelfie() {
  const navigate = useNavigate()
  const updateDriver = useAuthStore(s => s.updateDriver)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [stage, setStage] = useState<Stage>('camera')
  const [cameraReady, setCameraReady] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [camError, setCamError] = useState('')
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    void startCamera()
    return stopCamera
  }, [])

  async function startCamera() {
    setCamError('')
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => setCameraReady(true)
      }
    } catch (err) {
      const name = (err as Error).name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermissionDenied(true)
      } else {
        setCamError('Could not access camera. Please check your device settings.')
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (!video.videoWidth || !video.videoHeight) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Mirror the captured frame to match what the user saw
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(blob => {
      if (!blob) return
      setCapturedBlob(blob)
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
      setStage('preview')
      stopCamera()
    }, 'image/jpeg', 0.92)
  }

  function retake() {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setCapturedBlob(null)
    setSubmitError('')
    setStage('camera')
    void startCamera()
  }

  function handleBack() {
    if (stage === 'preview') {
      retake()
    } else {
      stopCamera()
      navigate(-1)
    }
  }

  async function handleSubmit() {
    if (!capturedBlob || stage === 'submitting') return
    setSubmitError('')
    setStage('submitting')
    try {
      const file = new File([capturedBlob], 'selfie.jpg', { type: 'image/jpeg' })
      await onboardingApi.uploadDriverDoc(file, 'profile_photo')
      await onboardingApi.submitApplication()
      updateDriver({ onboarding_step: 'pending_review', status: 'pending_approval' })
      navigate('/onboarding/pending-review', { replace: true })
    } catch {
      setSubmitError('Submission failed. Please try again.')
      setStage('preview')
    }
  }

  // ── Permission denied ──────────────────────────────────────────────────────

  if (permissionDenied) {
    const guide = getBrowserPermissionGuide()
    return (
      <div
        className="min-h-[100dvh] bg-black flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center overflow-y-auto">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-6 flex-shrink-0">
            <Lock size={32} className="text-white/80" />
          </div>
          <h2 className="text-white text-xl font-bold mb-3">Camera access blocked</h2>
          <p className="text-white/60 text-sm leading-relaxed mb-6">
            {guide.browserLabel} is blocking camera access for this site. Enable it, then reload:
          </p>
          <div
            className="w-full rounded-2xl p-4 mb-4 text-left space-y-4"
            style={{ background: 'rgba(255,255,255,0.07)' }}
          >
            {guide.steps.map((instruction, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold mt-0.5">
                  {i + 1}
                </span>
                <p className="text-white/80 text-sm leading-relaxed">{instruction}</p>
              </div>
            ))}
          </div>
          <p className="text-white/30 text-xs">
            Look for a camera or lock icon in the address bar, that's where site permissions live in a browser.
          </p>
        </div>
        <div className="px-6 pb-8 pt-2 flex flex-col gap-3">
          <button
            onClick={() => window.location.reload()}
            className="btn-go w-full flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} />
            Reload page
          </button>
          <button
            onClick={() => { setPermissionDenied(false); void startCamera() }}
            className="text-white/60 text-sm font-medium py-2"
          >
            Try again without reloading
          </button>
        </div>
      </div>
    )
  }

  if (camError) {
    return (
      <div
        className="min-h-[100dvh] bg-black flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-6">
            <Camera size={32} className="text-white/60" />
          </div>
          <h2 className="text-white text-lg font-bold mb-2">Camera unavailable</h2>
          <p className="text-white/60 text-sm leading-relaxed">{camError}</p>
        </div>
        <div className="px-6 pb-8">
          <button
            onClick={() => void startCamera()}
            className="btn-go w-full flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100dvh] bg-black flex flex-col overflow-hidden">
      {/* Hidden canvas used only for frame capture */}
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      {/* Step bar + back button: white on dark bg */}
      <div
        className="relative z-20 px-5 flex items-center gap-4 pb-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <button
          onClick={handleBack}
          disabled={stage === 'submitting'}
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          aria-label={stage === 'preview' ? 'Retake photo' : 'Go back'}
        >
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="flex gap-1.5 flex-1">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${i <= STEP_IDX ? 'bg-white' : 'bg-white/25'}`} />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>

        {/* ── Camera stage ──────────────────────────────────────────────── */}
        {stage === 'camera' && (
          <motion.div
            key="camera"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col"
          >
            {/* Live feed */}
            <div className="relative flex-1 overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Front camera feed"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />

              {/* Loading veil: fades out once the stream produces its first frame */}
              <AnimatePresence>
                {!cameraReady && (
                  <motion.div
                    key="cam-loading"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 flex items-center justify-center z-20 bg-black"
                  >
                    <OcarSpinner size={40} variant="white" />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Dark overlay with oval cutout */}
              <OvalOverlay />

              {/* Instruction chip: above oval */}
              <div className="absolute top-6 left-0 right-0 flex justify-center z-10 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-black/50 backdrop-blur-md rounded-full px-5 py-2"
                >
                  <p className="text-white text-xs font-semibold tracking-wide">
                    Position your face in the oval
                  </p>
                </motion.div>
              </div>

              {/* Tips chip: below oval */}
              <div className="absolute bottom-8 left-0 right-0 flex justify-center z-10 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-black/40 backdrop-blur-md rounded-full px-5 py-2.5"
                >
                  <p className="text-white/90 text-xs text-center leading-relaxed">
                    Look straight &nbsp;·&nbsp; Good lighting &nbsp;·&nbsp; Clear view of face
                  </p>
                </motion.div>
              </div>
            </div>

            {/* Shutter row */}
            <div className="bg-black pt-6 pb-10 flex flex-col items-center gap-3">
              <motion.button
                onClick={capture}
                whileTap={{ scale: 0.92 }}
                disabled={!cameraReady}
                aria-label="Capture selfie"
                className="relative flex items-center justify-center disabled:opacity-40"
                style={{ width: 76, height: 76 }}
              >
                {/* Outer ring */}
                <div className="absolute inset-0 rounded-full border-2 border-white/60" />
                {/* Inner disc */}
                <div className="w-[60px] h-[60px] rounded-full bg-white" />
              </motion.button>
              <p className="text-white/70 text-xs">Tap to capture</p>
            </div>
          </motion.div>
        )}

        {/* ── Preview / Submitting stage ────────────────────────────────── */}
        {(stage === 'preview' || stage === 'submitting') && previewUrl && (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col"
          >
            {/* Frozen preview */}
            <div className="relative flex-1 overflow-hidden">
              <img
                src={previewUrl}
                alt="Selfie preview"
                className="absolute inset-0 w-full h-full object-cover"
              />
              {/* Same oval on preview so user sees their face inside it */}
              <OvalOverlay dimmed />

              {/* "Preview" label */}
              <div className="absolute top-6 left-0 right-0 flex justify-center z-10 pointer-events-none">
                <div className="bg-black/50 backdrop-blur-md rounded-full px-5 py-2">
                  <p className="text-white text-xs font-semibold tracking-wide">Review your photo</p>
                </div>
              </div>
            </div>

            {/* Action row */}
            <div className="bg-black pt-6 pb-10 px-6 flex flex-col gap-3">
              {submitError && (
                <p className="text-red-400 text-xs text-center mb-1">{submitError}</p>
              )}

              <button
                onClick={() => void handleSubmit()}
                disabled={stage === 'submitting'}
                className="btn-go w-full"
                style={{ minHeight: 52 }}
              >
                {stage === 'submitting'
                  ? <span className="flex items-center justify-center gap-2">
                      <OcarSpinner size={16} variant="white" />
                      Submitting…
                    </span>
                  : 'Submit & Start Driving'}
              </button>

              <button
                onClick={retake}
                disabled={stage === 'submitting'}
                className="flex items-center justify-center gap-2 text-white/80 text-sm font-semibold py-3 min-h-[44px] rounded-2xl border border-white/20 disabled:opacity-40"
              >
                <RefreshCw size={14} />
                Retake
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}

// ── Oval guide overlay ─────────────────────────────────────────────────────────
// Uses the box-shadow trick: the oval element IS the transparent hole;
// a 9999px spread box-shadow fills everything outside it.
// L-shaped corner brackets follow the Aadhaar/KYC convention, they mark the
// four corners of the bounding box, not the ellipse border.

const B = 18  // bracket arm length
const T = 3   // arm thickness
const R = 1.5 // border-radius

const BRACKET_COLOR = 'rgba(255,255,255,0.95)'

const CORNER_BRACKETS = [
  // top-left
  { key: 'tl-h', top: 0, left: 0, width: B, height: T },
  { key: 'tl-v', top: 0, left: 0, width: T, height: B },
  // top-right
  { key: 'tr-h', top: 0, right: 0, width: B, height: T },
  { key: 'tr-v', top: 0, right: 0, width: T, height: B },
  // bottom-left
  { key: 'bl-h', bottom: 0, left: 0, width: B, height: T },
  { key: 'bl-v', bottom: 0, left: 0, width: T, height: B },
  // bottom-right
  { key: 'br-h', bottom: 0, right: 0, width: B, height: T },
  { key: 'br-v', bottom: 0, right: 0, width: T, height: B },
]

function OvalOverlay({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      {/* Positioning wrapper: oval is roughly portrait 3:4 */}
      <div style={{ width: '62%', aspectRatio: '3/4', position: 'relative' }}>
        {/* The oval + shadow-fill */}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            boxShadow: `0 0 0 9999px rgba(0,0,0,${dimmed ? 0.52 : 0.60})`,
            border: '2px solid rgba(255,255,255,0.55)',
          }}
        />
        {/* L-shaped corner brackets */}
        {CORNER_BRACKETS.map(({ key, ...style }) => (
          <div
            key={key}
            style={{ position: 'absolute', background: BRACKET_COLOR, borderRadius: R, ...style }}
          />
        ))}
      </div>
    </div>
  )
}
