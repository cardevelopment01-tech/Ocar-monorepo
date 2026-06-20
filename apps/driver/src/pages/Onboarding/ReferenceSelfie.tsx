import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Camera } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { onboardingApi } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

type Stage = 'camera' | 'preview' | 'submitting'

export default function ReferenceSelfie() {
  const navigate = useNavigate()
  const updateDriver = useAuthStore(s => s.updateDriver)
  const driver = useAuthStore(s => s.driver)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [stage, setStage] = useState<Stage>('camera')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [camError, setCamError] = useState('')
  const [submitError, setSubmitError] = useState('')

  const steps = ['personal_info', 'vehicle_info', 'documents', 'selfie']
  const stepIdx = steps.indexOf(driver?.onboarding_step ?? 'selfie')

  useEffect(() => {
    void startCamera()
    return stopCamera
  }, [])

  async function startCamera() {
    setCamError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
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
    return (
      <div className="min-h-screen bg-bg text-text-primary flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-full bg-surface-2 flex items-center justify-center mb-6">
          <Camera size={36} className="text-text-muted" />
        </div>
        <h2 className="text-xl font-bold mb-2">Camera access required</h2>
        <p className="text-text-secondary text-sm leading-relaxed mb-8">
          Please allow camera access in your browser or app settings, then try again.
        </p>
        <button
          onClick={() => { setPermissionDenied(false); void startCamera() }}
          className="text-primary font-semibold text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    )
  }

  if (camError) {
    return (
      <div className="min-h-screen bg-bg text-text-primary flex flex-col items-center justify-center px-8 text-center">
        <p className="text-text-secondary text-sm mb-6">{camError}</p>
        <button onClick={() => void startCamera()} className="text-primary font-semibold text-sm flex items-center gap-2">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    )
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black flex flex-col overflow-hidden">
      {/* Hidden canvas used only for frame capture */}
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      {/* Step bar + back button — white on dark bg */}
      <div className="relative z-20 px-5 pt-12 flex items-center gap-4">
        <button
          onClick={() => { stopCamera(); navigate(-1) }}
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0"
          aria-label="Go back"
        >
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="flex gap-1.5 flex-1">
          {steps.map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${i <= stepIdx ? 'bg-white' : 'bg-white/20'}`} />
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
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />

              {/* Dark overlay with oval cutout */}
              <OvalOverlay />

              {/* Instruction chip — above oval */}
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

              {/* Tips chip — below oval */}
              <div className="absolute bottom-8 left-0 right-0 flex justify-center z-10 pointer-events-none">
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-black/40 backdrop-blur-md rounded-2xl px-5 py-2.5"
                >
                  <p className="text-white/90 text-xs text-center leading-relaxed">
                    Look straight &nbsp;·&nbsp; Good lighting &nbsp;·&nbsp; No glasses
                  </p>
                </motion.div>
              </div>
            </div>

            {/* Shutter row */}
            <div className="bg-black pt-6 pb-10 flex flex-col items-center gap-3">
              <motion.button
                onClick={capture}
                whileTap={{ scale: 0.92 }}
                aria-label="Capture selfie"
                className="relative flex items-center justify-center"
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
            <div className="bg-black pt-5 pb-10 px-6 flex flex-col gap-3">
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
                      <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Submitting…
                    </span>
                  : 'Submit & Start Driving'}
              </button>

              <button
                onClick={retake}
                disabled={stage === 'submitting'}
                className="flex items-center justify-center gap-2 text-white/80 text-sm font-semibold py-3.5 min-h-[44px] disabled:opacity-40"
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

function OvalOverlay({ dimmed = false }: { dimmed?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      {/* Positioning wrapper — oval is roughly portrait 3:4 */}
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

        {/* Corner tick marks for a KYC/verification feel */}
        {[
          { top: -1, left: '50%', transform: 'translateX(-50%)', width: 24, height: 3, borderRadius: 2 },
          { bottom: -1, left: '50%', transform: 'translateX(-50%)', width: 24, height: 3, borderRadius: 2 },
          { left: -1, top: '50%', transform: 'translateY(-50%)', width: 3, height: 24, borderRadius: 2 },
          { right: -1, top: '50%', transform: 'translateY(-50%)', width: 3, height: 24, borderRadius: 2 },
        ].map((style, i) => (
          <div
            key={i}
            style={{ position: 'absolute', background: 'rgba(255,255,255,0.9)', ...style }}
          />
        ))}
      </div>
    </div>
  )
}
