import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function ModeSelection() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10">
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="text-xl font-bold">Go Online</h1>
          <p className="text-text-muted text-xs">Choose your driving mode</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Standard */}
        <button
          onClick={() => navigate('/go-online/standard')}
          className="w-full bg-surface rounded-3xl border-2 border-border hover:border-primary transition-all p-5 text-left group"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/30 transition-colors">
              <span className="text-3xl">🚗</span>
            </div>
            <div className="flex-1">
              <p className="text-text-primary font-bold text-lg">Standard Mode</p>
              <p className="text-text-secondary text-sm mt-1">
                Accept rides anywhere in the city. Best for maximizing earnings.
              </p>
              <div className="flex gap-2 mt-3">
                <span className="bg-surface-3 text-primary text-xs font-semibold px-3 py-1 rounded-full">All areas</span>
                <span className="bg-surface-3 text-text-secondary text-xs font-semibold px-3 py-1 rounded-full">No restriction</span>
              </div>
            </div>
          </div>
        </button>

        {/* Return cab */}
        <button
          onClick={() => navigate('/go-online/return-cab')}
          className="w-full bg-surface rounded-3xl border-2 border-border hover:border-accent-blue transition-all p-5 text-left group"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-accent-blue/20 flex items-center justify-center flex-shrink-0 group-hover:bg-accent-blue/30 transition-colors">
              <span className="text-3xl">↩️</span>
            </div>
            <div className="flex-1">
              <p className="text-text-primary font-bold text-lg">Return Cab</p>
              <p className="text-text-secondary text-sm mt-1">
                Set a destination and only accept rides heading in that direction.
              </p>
              <div className="flex gap-2 mt-3">
                <span className="bg-surface-3 text-accent-blue text-xs font-semibold px-3 py-1 rounded-full">Direction-based</span>
                <span className="bg-surface-3 text-text-secondary text-xs font-semibold px-3 py-1 rounded-full">Headed home</span>
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
