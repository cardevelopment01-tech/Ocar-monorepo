import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { mockDriver } from '@/lib/mock-data'

export default function StandardConfirm() {
  const navigate = useNavigate()

  const CHECKLIST = [
    'Vehicle is clean and ready',
    'AC working properly',
    'Phone is charged',
    'Documents are up to date',
  ]

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10 flex flex-col">
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <h1 className="text-xl font-bold">Ready to Drive?</h1>
      </div>

      {/* Vehicle info */}
      <div className="bg-surface rounded-3xl border border-border p-5 mb-4">
        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">Your Vehicle</p>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center text-3xl">
            🚗
          </div>
          <div>
            <p className="text-text-primary font-bold text-lg">{mockDriver.vehicle.name}</p>
            <p className="text-text-secondary">{mockDriver.vehicle.plate}</p>
            <p className="text-text-muted text-sm">{mockDriver.vehicle.color} · {mockDriver.vehicle.category}</p>
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="bg-surface rounded-3xl border border-border p-5 mb-6">
        <p className="text-text-secondary text-sm font-semibold mb-4">Pre-ride Checklist</p>
        {CHECKLIST.map(item => (
          <div key={item} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
            <CheckCircle size={18} className="text-primary flex-shrink-0" />
            <span className="text-text-secondary text-sm">{item}</span>
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <button
        onClick={() => navigate('/')}
        className="btn-go w-full"
        style={{ minHeight: 56 }}
      >
        Go Online Now
      </button>
    </div>
  )
}
