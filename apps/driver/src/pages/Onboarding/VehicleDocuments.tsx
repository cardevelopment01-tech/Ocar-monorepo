import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, CheckCircle } from 'lucide-react'

export default function VehicleDocuments() {
  const navigate = useNavigate()
  const [rc, setRc] = useState(false)
  const [insurance, setInsurance] = useState(false)
  const [permit, setPermit] = useState(false)

  const DocCard = ({ label, done, onUpload }: { label: string; done: boolean; onUpload: () => void }) => (
    <button
      onClick={onUpload}
      className={`w-full flex items-center gap-4 bg-surface rounded-2xl border-2 px-5 py-4 mb-3 transition-all ${done ? 'border-primary' : 'border-border'}`}
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${done ? 'bg-primary/20' : 'bg-surface-3'}`}>
        {done
          ? <CheckCircle size={22} className="text-primary" />
          : <Upload size={22} className="text-text-muted" />
        }
      </div>
      <div className="text-left">
        <p className={`font-semibold text-sm ${done ? 'text-primary' : 'text-text-primary'}`}>{label}</p>
        <p className="text-text-muted text-xs mt-0.5">{done ? 'Document uploaded' : 'Tap to upload'}</p>
      </div>
    </button>
  )

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10">
      <div className="flex gap-1.5 mb-8">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`flex-1 h-1 rounded-full ${i <= 4 ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 4 of 5</p>
          <h1 className="text-xl font-bold">Vehicle Documents</h1>
        </div>
      </div>

      <DocCard label="Registration Certificate (RC)" done={rc} onUpload={() => setRc(true)} />
      <DocCard label="Insurance Certificate" done={insurance} onUpload={() => setInsurance(true)} />
      <DocCard label="Commercial Permit" done={permit} onUpload={() => setPermit(true)} />

      <button
        onClick={() => navigate('/onboarding/selfie')}
        disabled={!rc || !insurance || !permit}
        className="btn-go w-full mt-2"
        style={{ minHeight: 56 }}
      >
        Continue
      </button>
    </div>
  )
}
