import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle } from 'lucide-react'
import { motion } from 'framer-motion'

export default function ReferenceSelfie() {
  const navigate = useNavigate()
  const [taken, setTaken] = useState(false)

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10 flex flex-col">
      <div className="flex gap-1.5 mb-8">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`flex-1 h-1 rounded-full ${i <= 5 ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 5 of 5</p>
          <h1 className="text-xl font-bold">Reference Selfie</h1>
        </div>
      </div>

      <p className="text-text-secondary text-sm mb-8 leading-relaxed">
        Take a clear selfie so riders can identify you. Make sure your face is well-lit and visible.
      </p>

      {/* Selfie frame */}
      <div className="flex-1 flex items-center justify-center">
        <motion.button
          onClick={() => setTaken(true)}
          whileTap={{ scale: 0.96 }}
          className="relative"
        >
          <div
            className={`w-48 h-48 rounded-full flex items-center justify-center transition-all ${taken ? 'bg-primary/20 border-4 border-primary' : 'bg-surface-2 border-4 border-dashed border-border'}`}
            style={taken ? { boxShadow: '0 0 60px rgba(34,197,94,0.25)' } : undefined}
          >
            {taken
              ? <CheckCircle size={64} className="text-primary" />
              : <Camera size={48} className="text-text-muted" />
            }
          </div>
          {!taken && (
            <p className="text-text-muted text-xs text-center mt-4">Tap to take selfie</p>
          )}
          {taken && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-primary text-sm font-semibold text-center mt-4"
            >
              Selfie captured ✓
            </motion.p>
          )}
        </motion.button>
      </div>

      <button
        onClick={() => navigate('/')}
        disabled={!taken}
        className="btn-go w-full"
        style={{ minHeight: 56 }}
      >
        Submit & Start Driving
      </button>
    </div>
  )
}
