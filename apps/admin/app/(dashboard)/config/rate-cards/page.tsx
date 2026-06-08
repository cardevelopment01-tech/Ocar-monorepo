'use client'
import { useState } from 'react'
import { Plus, Tag } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import { mockRateCards } from '@/lib/mock-data'

export default function RateCardsPage() {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="space-y-5">
      {/* Header actions */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          <Plus size={15} /> Add New Rate
        </button>
      </div>

      {/* Rates table */}
      <div className="admin-card">
        <div className="flex items-center gap-2 mb-4">
          <Tag size={16} className="text-text-muted" />
          <h2 className="text-md font-bold text-text-primary">Current Rate Cards</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Ride Type</th>
              <th>Per KM</th>
              <th>Per Min</th>
              <th>Min Fare</th>
              <th>Return Rate</th>
              <th>Updated By</th>
              <th>Updated At</th>
            </tr>
          </thead>
          <tbody>
            {mockRateCards.map(rc => (
              <tr key={rc.id} className="group bg-surface hover:bg-primary-light">
                <td className="font-semibold text-text-primary">
                  <span className="flex items-center gap-2">
                    {rc.category}
                    <StatusPill status={rc.category.toLowerCase()} />
                  </span>
                </td>
                <td><StatusPill status={rc.rideType} /></td>
                <td className="font-mono font-semibold text-text-primary">₹{rc.perKm}</td>
                <td className="font-mono font-semibold text-text-primary">₹{rc.perMin}</td>
                <td className="font-mono font-semibold text-text-primary">₹{rc.minFare}</td>
                <td className="font-mono text-text-secondary">{rc.returnRate ? `₹${rc.returnRate}/km` : <span className="text-text-muted">—</span>}</td>
                <td className="text-text-secondary">{rc.updatedBy}</td>
                <td className="text-text-muted">{rc.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rate History */}
      <details className="admin-card">
        <summary className="cursor-pointer text-sm font-bold text-text-primary flex items-center gap-2 list-none">
          <span>▸</span> Rate Change History
        </summary>
        <div className="mt-4 text-sm text-text-muted text-center py-6">
          No historical rate changes recorded yet.
        </div>
      </details>

      {/* Add Rate Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[480px] animate-fade-in">
            <h2 className="text-lg font-bold text-text-primary mb-5">New Rate Card</h2>
            <div className="space-y-4">
              {[
                { label: 'Category',     type: 'select', options: ['Hatchback','Sedan','SUV','Auto'] },
                { label: 'Ride Type',    type: 'select', options: ['one_way','round_trip','rental'] },
                { label: 'Per KM (₹)',  type: 'number' },
                { label: 'Per Min (₹)', type: 'number' },
                { label: 'Min Fare (₹)',type: 'number' },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">{f.label}</label>
                  {f.type === 'select' ? (
                    <select className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:border-primary text-text-primary">
                      {f.options?.map(o => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type="number" className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:border-primary text-text-primary" />
                  )}
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5 block">Notes (reason for change)</label>
                <textarea rows={2} className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:border-primary resize-none text-text-primary" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-2 transition-colors">Cancel</button>
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark transition-colors">Save Rate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
