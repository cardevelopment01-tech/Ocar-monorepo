import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin } from 'lucide-react'

const POPULAR = [
  'Bhubaneswar Railway Station',
  'Bhubaneswar Airport',
  'Patia',
  'Infocity',
  'Kalinga Nagar',
]

export default function ReturnCabSetup() {
  const navigate = useNavigate()
  const [destination, setDestination] = useState('')
  const [selected, setSelected] = useState('')

  const choose = (d: string) => { setSelected(d); setDestination(d) }

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10 flex flex-col">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="text-xl font-bold">Return Cab</h1>
          <p className="text-text-muted text-xs">Where are you headed?</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 bg-surface-2 border border-border rounded-2xl px-4 h-[52px] mb-5 focus-within:border-primary transition-colors">
        <MapPin size={18} className="text-text-muted flex-shrink-0" />
        <input
          className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
          placeholder="Search destination…"
          value={destination}
          onChange={e => { setDestination(e.target.value); setSelected('') }}
        />
      </div>

      {/* Popular */}
      <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-3">Popular</p>
      <div className="space-y-2 mb-auto">
        {POPULAR.filter(p => !destination || p.toLowerCase().includes(destination.toLowerCase())).map(p => (
          <button
            key={p}
            onClick={() => choose(p)}
            className={`w-full flex items-center gap-3 bg-surface rounded-2xl border px-4 py-3.5 text-left transition-all ${selected === p ? 'border-primary' : 'border-border'}`}
          >
            <MapPin size={16} className={selected === p ? 'text-primary' : 'text-text-muted'} />
            <span className={`text-sm font-semibold ${selected === p ? 'text-primary' : 'text-text-primary'}`}>{p}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => navigate('/')}
        disabled={!selected && !destination}
        className="btn-go w-full mt-6"
        style={{ minHeight: 56 }}
      >
        Go Online — Return to {selected || destination || '…'}
      </button>
    </div>
  )
}
