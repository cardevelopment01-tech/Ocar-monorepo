'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { adminRideApi, type AdminRideItem, type AssignCandidate } from '@/lib/admin-api'

interface Props {
  ride: AdminRideItem | null
  onClose: () => void
  onAssigned: () => void
}

export default function AssignDriverDrawer({ ride, onClose, onAssigned }: Props) {
  const reduce = useReducedMotion()
  const [candidates, setCandidates] = useState<AssignCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'request' | 'force'>('request')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showOffline, setShowOffline] = useState(false)

  useEffect(() => {
    if (!ride) return
    setConfirmingId(null)
    setAssigningId(null)
    setSearch('')
    setShowOffline(false)
    setLoading(true)
    setError(null)
    adminRideApi.getAssignCandidates(ride.id)
      .then(setCandidates)
      .catch(() => setError('Could not load drivers for this ride.'))
      .finally(() => setLoading(false))
  }, [ride])

  async function handleSelect(candidate: AssignCandidate) {
    if (!ride) return
    if (!candidate.eligible && confirmingId !== candidate.driver_id) {
      setConfirmingId(candidate.driver_id)
      return
    }
    setAssigningId(candidate.driver_id)
    setError(null)
    try {
      await adminRideApi.assignDriver(ride.id, candidate.driver_id, mode, !candidate.eligible)
      onAssigned()
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(message ?? 'Assignment failed — the ride may have already been accepted.')
    } finally {
      setAssigningId(null)
      setConfirmingId(null)
    }
  }

  const filtered = candidates.filter(c => {
    if (!showOffline && c.is_online === false) return false
    return !search || c.driver_name.toLowerCase().includes(search.toLowerCase()) || c.driver_phone.includes(search)
  })

  return (
    <AnimatePresence>
      {ride && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.15 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 right-0 h-full w-full max-w-md bg-surface z-50 shadow-xl flex flex-col"
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                Assign Driver — Ride #{ride.id}
              </h2>
              <button onClick={onClose} className="text-text-muted text-sm hover:text-text-primary transition-colors duration-150">
                Close
              </button>
            </div>

            <div className="p-4 space-y-3 border-b border-border">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or phone..."
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-muted">Mode:</span>
                <button
                  onClick={() => setMode('request')}
                  className={`px-3 py-1.5 rounded-full font-semibold transition-colors duration-150 ${mode === 'request' ? 'bg-primary text-white' : 'bg-surface-2 text-text-muted'}`}
                >
                  Send as Request
                </button>
                <button
                  onClick={() => setMode('force')}
                  className={`px-3 py-1.5 rounded-full font-semibold transition-colors duration-150 ${mode === 'force' ? 'bg-primary text-white' : 'bg-surface-2 text-text-muted'}`}
                >
                  Force Assign
                </button>
                <span className="text-text-muted ml-2">Filter:</span>
                <button
                  onClick={() => setShowOffline(v => !v)}
                  className={`px-3 py-1.5 rounded-full font-semibold transition-colors duration-150 ${showOffline ? 'bg-primary text-white' : 'bg-surface-2 text-text-muted'}`}
                >
                  Show offline drivers
                </button>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading && <p className="p-4 text-xs text-text-muted">Loading drivers...</p>}
              {!loading && filtered.length === 0 && (
                <p className="p-4 text-xs text-text-muted">No drivers found in this city.</p>
              )}
              {filtered.map(c => (
                <div key={c.driver_id} className="border-b border-border-light">
                  <div
                    className={`flex items-center justify-between px-4 py-3 transition-colors duration-150 ${!c.eligible ? 'opacity-50' : 'hover:bg-surface-2'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{c.driver_name}</p>
                      <p className="text-xs text-text-muted">
                        {c.category_name ?? 'No category'}
                        {c.distance_metres != null && ` · ${(c.distance_metres / 1000).toFixed(1)} km`}
                        {!c.is_online && ' · Offline'}
                        {c.is_online && !c.category_ok && ' · Wrong category'}
                        {c.is_online && c.category_ok && !c.wallet_ok && ' · Low balance'}
                      </p>
                    </div>
                    <button
                      disabled={assigningId === c.driver_id}
                      onClick={() => void handleSelect(c)}
                      className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-full disabled:opacity-50 hover:bg-primary-dark transition-colors duration-150 flex-shrink-0"
                    >
                      {c.eligible ? 'Select' : 'Select anyway'}
                    </button>
                  </div>
                  <AnimatePresence>
                    {confirmingId === c.driver_id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduce ? 0.01 : 0.2 }}
                        className="px-4 pb-3 overflow-hidden"
                      >
                        <div className="px-3 py-2 rounded-lg bg-warning-light text-warning text-xs flex items-center justify-between gap-2">
                          <span>{c.driver_name} is not fully eligible — assign anyway?</span>
                          <button
                            disabled={assigningId === c.driver_id}
                            onClick={() => void handleSelect(c)}
                            className="px-2 py-1 rounded-full bg-warning text-white font-semibold flex-shrink-0"
                          >
                            Confirm
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
