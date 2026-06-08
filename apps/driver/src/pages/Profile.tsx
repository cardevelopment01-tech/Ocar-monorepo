import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Star, Car, ChevronRight } from 'lucide-react'
import StatusBar from '@/components/ui/StatusBar'
import { mockDriver, mockEarnings } from '@/lib/mock-data'

const MENU_ITEMS = [
  { label: 'Vehicle Details',     sub: `${mockDriver.vehicle.plate} · ${mockDriver.vehicle.name}` },
  { label: 'Documents',          sub: 'All verified'           },
  { label: 'Bank Account',       sub: 'HDFC ···4321'           },
  { label: 'Emergency Contacts', sub: '2 contacts added'       },
  { label: 'Help & Support',     sub: 'FAQs, chat support'     },
  { label: 'Terms & Privacy',    sub: ''                        },
]

export default function Profile() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-10">
      <StatusBar isOnline={true} earningsToday={mockEarnings.today.total} />

      <div className="flex items-center gap-3 px-4 pt-16 pb-4">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <h1 className="text-xl font-bold">Profile</h1>
      </div>

      {/* Avatar card */}
      <div className="mx-4 bg-surface rounded-3xl p-5 mb-4 border border-border flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center">
          <span className="text-3xl font-black text-primary">{mockDriver.name.charAt(0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary font-bold text-lg">{mockDriver.name}</p>
          <p className="text-text-muted text-sm">+91 {mockDriver.phone}</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <Star size={14} className="text-accent-amber fill-accent-amber" />
              <span className="text-text-secondary text-sm font-semibold">{mockDriver.rating}</span>
            </div>
            <div className="flex items-center gap-1">
              <Car size={14} className="text-text-muted" />
              <span className="text-text-muted text-xs">{mockDriver.totalTrips} trips</span>
            </div>
          </div>
        </div>
        <span className="bg-primary/20 text-primary text-xs font-bold px-2 py-1 rounded-full">
          {mockDriver.badge}
        </span>
      </div>

      {/* Stats */}
      <div className="mx-4 grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Acceptance',   value: `${mockDriver.acceptanceRate}%`, good: mockDriver.acceptanceRate >= 80 },
          { label: 'Completion',   value: `${mockDriver.completionRate}%`, good: mockDriver.completionRate >= 90 },
          { label: 'Cancellation', value: `${mockDriver.cancellationRate}%`, good: mockDriver.cancellationRate <= 5 },
        ].map(s => (
          <div key={s.label} className="bg-surface rounded-2xl p-3 border border-border text-center">
            <p className={`font-black text-xl ${s.good ? 'text-primary' : 'text-accent-red'}`}>{s.value}</p>
            <p className="text-text-muted text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Menu */}
      <div className="mx-4 bg-surface rounded-3xl border border-border overflow-hidden">
        {MENU_ITEMS.map((item, i) => (
          <button
            key={item.label}
            className={`w-full flex items-center justify-between px-5 py-4 hover:bg-surface-2 transition-colors ${i < MENU_ITEMS.length - 1 ? 'border-b border-border' : ''}`}
          >
            <div className="text-left">
              <p className="text-text-primary font-semibold text-sm">{item.label}</p>
              {item.sub && <p className="text-text-muted text-xs mt-0.5">{item.sub}</p>}
            </div>
            <ChevronRight size={16} className="text-text-muted" />
          </button>
        ))}
      </div>

      {/* Logout */}
      <div className="mx-4 mt-4">
        <button
          onClick={() => navigate('/login')}
          className="btn-danger w-full"
          style={{ minHeight: 52 }}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
