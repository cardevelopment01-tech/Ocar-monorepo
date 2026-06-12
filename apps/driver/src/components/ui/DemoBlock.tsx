import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'

interface DemoBlockProps {
  feature: string
}

export default function DemoBlock({ feature }: DemoBlockProps) {
  const navigate = useNavigate()

  return (
    <div className="h-screen flex flex-col items-center justify-center px-8 bg-background">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
      >
        <Lock size={26} color="white" strokeWidth={1.8} />
      </div>

      <h2 className="text-lg font-bold text-text-primary mb-1.5 text-center">{feature}</h2>

      <p
        className="text-xs font-semibold uppercase tracking-widest mb-3 px-3 py-1 rounded-full"
        style={{ background: '#EEF2FF', color: '#4F46E5' }}
      >
        Coming Soon
      </p>

      <p className="text-sm text-text-muted text-center max-w-xs leading-relaxed">
        We're building this next — the full experience is just around the corner.
      </p>

      <button
        onClick={() => navigate('/', { replace: true })}
        className="mt-8 text-sm font-semibold text-primary active:opacity-70 transition-opacity"
      >
        ← Back to Home
      </button>
    </div>
  )
}
