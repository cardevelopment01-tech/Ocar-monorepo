import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, RefreshCw } from 'lucide-react'
import { driverVerificationApi } from '@/lib/driver-verification-api'
import OcarSpinner from '@/components/ui/OcarSpinner'

type Step = 'selfie' | 'plate'
type Stage = 'camera' | 'preview'

const STEP_CONFIG: Record<Step, { title: string; instruction: string; facingMode: 'user' | 'environment' }> = {
  selfie: { title: "Take today's selfie", instruction: 'Look straight at the camera', facingMode: 'user' },
  plate:  { title: 'Photograph your number plate', instruction: 'Make sure the plate is clearly readable', facingMode: 'environment' },
}

export default function DailyVerification() {
  const navigate = useNavigate()

  const videoRef  = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step, setStep] = useState<Step>('selfie')
  const [stage, setStage] = useState<Stage>('camera')
  const [cameraReady, setCameraReady] = useState(false)
  const [camError, setCamError] = useState('')
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    void startCamera()
    return stopCamera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function startCamera() {
    setCamError('')
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: STEP_CONFIG[step].facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => setCameraReady(true)
      }
    } catch {
      setCamError('Could not access camera. Please check your device settings and try again.')
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return

    const MAX_EDGE = 1280
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
    canvas.width  = Math.round(video.videoWidth  * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (step === 'selfie') {
      // Mirror the selfie to match what the user saw in the preview
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {
      if (!blob) return
      setSelfieBlob(blob)
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
      setStage('preview')
      stopCamera()
    }, 'image/jpeg', 0.85)
  }

  function retake() {
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    setSelfieBlob(null)
    setSubmitError('')
    setStage('camera')
    void startCamera()
  }

  const [pendingSelfie, setPendingSelfie] = useState<File | null>(null)

  async function handleNext() {
    if (!selfieBlob) return
    const file = new File([selfieBlob], `${step}.jpg`, { type: 'image/jpeg' })

    if (step === 'selfie') {
      setPendingSelfie(file)
      setSelfieBlob(null)
      setPreviewUrl(null)
      setStep('plate')
      setStage('camera')
      return
    }

    if (!pendingSelfie) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await driverVerificationApi.submit(pendingSelfie, file)
      navigate('/go-online/mode', { replace: true })
    } catch {
      setSubmitError('Submission failed. Please try again.')
      setSubmitting(false)
    }
  }

  function handleBack() {
    if (stage === 'preview') { retake(); return }
    if (step === 'plate') {
      setStep('selfie')
      setStage('camera')
      return
    }
    stopCamera()
    navigate(-1)
  }

  const config = STEP_CONFIG[step]

  return (
    <div
      className="min-h-[100dvh] bg-black flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      <div className="relative z-20 px-5 flex items-center gap-4 pb-3" style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}>
        <button
          onClick={handleBack}
          disabled={submitting}
          className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          aria-label="Go back"
        >
          <ArrowLeft size={18} className="text-white" />
        </button>
        <div className="flex gap-1.5 flex-1">
          <div className={`flex-1 h-1.5 rounded-full ${step === 'selfie' || step === 'plate' ? 'bg-white' : 'bg-white/25'}`} />
          <div className={`flex-1 h-1.5 rounded-full ${step === 'plate' ? 'bg-white' : 'bg-white/25'}`} />
        </div>
      </div>

      {camError ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-6">
            <Camera size={32} className="text-white/60" />
          </div>
          <h2 className="text-white text-lg font-bold mb-2">Camera unavailable</h2>
          <p className="text-white/60 text-sm leading-relaxed mb-6">{camError}</p>
          <button onClick={() => void startCamera()} className="btn-go w-full flex items-center justify-center gap-2">
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      ) : stage === 'camera' ? (
        <div className="flex-1 flex flex-col">
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label={`${config.title} camera feed`}
              className="absolute inset-0 w-full h-full object-cover"
              style={step === 'selfie' ? { transform: 'scaleX(-1)' } : undefined}
            />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <OcarSpinner size={40} variant="white" />
              </div>
            )}
            <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/50 backdrop-blur-md rounded-full px-5 py-2">
                <p className="text-white text-xs font-semibold tracking-wide">{config.title}</p>
              </div>
            </div>
            <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/40 backdrop-blur-md rounded-full px-5 py-2.5">
                <p className="text-white/90 text-xs text-center leading-relaxed">{config.instruction}</p>
              </div>
            </div>
          </div>
          <div className="bg-black pt-6 pb-10 flex flex-col items-center gap-3">
            <button
              onClick={capture}
              disabled={!cameraReady}
              aria-label={`Capture ${step}`}
              className="relative flex items-center justify-center disabled:opacity-40"
              style={{ width: 76, height: 76 }}
            >
              <div className="absolute inset-0 rounded-full border-2 border-white/60" />
              <div className="w-[60px] h-[60px] rounded-full bg-white" />
            </button>
            <p className="text-white/70 text-xs">Tap to capture</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="relative flex-1 overflow-hidden">
            {previewUrl && <img src={previewUrl} alt={`${step} preview`} className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-black/50 backdrop-blur-md rounded-full px-5 py-2">
                <p className="text-white text-xs font-semibold tracking-wide">Review your photo</p>
              </div>
            </div>
          </div>
          <div className="bg-black pt-6 pb-10 px-6 flex flex-col gap-3">
            {submitError && <p className="text-red-400 text-xs text-center mb-1">{submitError}</p>}
            <button
              onClick={() => void handleNext()}
              disabled={submitting}
              className="btn-go w-full"
              style={{ minHeight: 52 }}
            >
              {submitting
                ? <span className="flex items-center justify-center gap-2"><OcarSpinner size={16} variant="white" />Submitting…</span>
                : step === 'selfie' ? 'Next: Plate Photo' : 'Submit & Go Online'}
            </button>
            <button
              onClick={retake}
              disabled={submitting}
              className="flex items-center justify-center gap-2 text-white/80 text-sm font-semibold py-3 min-h-[44px] rounded-2xl border border-white/20 disabled:opacity-40"
            >
              <RefreshCw size={14} />
              Retake
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
