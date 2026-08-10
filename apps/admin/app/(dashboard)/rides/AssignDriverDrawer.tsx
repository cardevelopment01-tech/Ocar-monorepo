'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Search, AlertTriangle, ChevronDown, Loader2 } from 'lucide-react'
import { adminRideApi, type AdminRideItem, type AssignCandidate } from '@/lib/admin-api'
import SlideOver from '@/components/ui/SlideOver'

interface Props {
  ride: AdminRideItem | null
  onClose: () => void
  onAssigned: () => void
}

// Why a driver didn't make the primary list — mirrors the hard gates the
// backend already computes (is_online / category_ok / wallet_ok), just
// picked in priority order since a driver can fail more than one.
function exclusionReason(c: AssignCandidate): { label: string; tone: 'muted' | 'warning' } {
  if (!c.is_online) return { label: 'Offline', tone: 'muted' }
  if (!c.category_ok) return { label: 'Wrong category', tone: 'warning' }
  return {
    label: c.city_billing_mode === 'package' ? 'Package balance empty' : 'Below minimum balance',
    tone: 'warning',
  }
}

export default function AssignDriverDrawer({ ride, onClose, onAssigned }: Props) {
  const reduce = useReducedMotion()
  const [candidates, setCandidates] = useState<AssignCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'request' | 'force'>('request')
  const [showExcluded, setShowExcluded] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<{ id: string; message: string } | null>(null)

  const loadCandidates = useCallback((rideId: string) => {
    setLoading(true)
    setFetchError(null)
    adminRideApi.getAssignCandidates(rideId)
      .then(setCandidates)
      .catch(() => setFetchError('Could not load drivers for this ride.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!ride) return
    setConfirmingId(null)
    setAssigningId(null)
    setAssignError(null)
    setSearch('')
    setShowExcluded(false)
    loadCandidates(ride.id)
  }, [ride, loadCandidates])

  async function handleAssign(candidate: AssignCandidate) {
    if (!ride) return
    setAssigningId(candidate.driver_id)
    setAssignError(null)
    try {
      await adminRideApi.assignDriver(ride.id, candidate.driver_id, mode, !candidate.eligible)
      onAssigned()
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setAssignError({ id: candidate.driver_id, message: message ?? 'Assignment failed — the ride may have already been accepted.' })
    } finally {
      setAssigningId(null)
      setConfirmingId(null)
    }
  }

  function handleSelectExcluded(candidate: AssignCandidate) {
    if (confirmingId !== candidate.driver_id) {
      setConfirmingId(candidate.driver_id)
      return
    }
    void handleAssign(candidate)
  }

  const matches = (c: AssignCandidate) =>
    !search || c.driver_name.toLowerCase().includes(search.toLowerCase()) || c.driver_phone.includes(search)

  const eligible = candidates.filter(c => c.eligible && matches(c))
  const excluded = candidates.filter(c => !c.eligible && matches(c))

  return (
    <SlideOver isOpen={!!ride} onClose={onClose} title={ride ? `Assign Driver — Ride #${ride.id}` : ''}>
      <div className="sticky top-0 z-10 bg-surface p-4 space-y-3 border-b border-border">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-surface-2 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted flex-shrink-0">Mode</span>
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
        </div>
      </div>

      {fetchError && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-danger-light text-danger text-xs flex items-center justify-between gap-2">
          <span>{fetchError}</span>
          <button onClick={() => ride && loadCandidates(ride.id)} className="font-semibold underline flex-shrink-0">
            Retry
          </button>
        </div>
      )}

      <div>
        {loading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <div className="h-3.5 bg-surface-2 rounded animate-pulse" style={{ width: 120 }} />
                  <div className="h-3 bg-surface-2 rounded animate-pulse" style={{ width: 80 }} />
                </div>
                <div className="h-7 bg-surface-2 rounded-full animate-pulse" style={{ width: 60 }} />
              </div>
            ))}
          </div>
        )}

        {!loading && !fetchError && candidates.length === 0 && (
          <p className="p-4 text-sm text-text-muted">No drivers found in this city.</p>
        )}

        {!loading && !fetchError && candidates.length > 0 && eligible.length === 0 && (
          <p className="px-4 pt-4 pb-1 text-sm text-text-muted">No drivers available right now.</p>
        )}

        {!loading && !fetchError && (
          <div className="p-2">
            {eligible.map(c => (
              <div key={c.driver_id} className="rounded-xl hover:bg-surface-2 transition-colors duration-150">
                <div className="flex items-center justify-between px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{c.driver_name}</p>
                    <p className="text-xs text-text-muted">
                      {c.category_name ?? 'No category'}
                      {c.distance_metres != null && ` · ${(c.distance_metres / 1000).toFixed(1)} km`}
                    </p>
                  </div>
                  <button
                    disabled={assigningId === c.driver_id}
                    onClick={() => void handleAssign(c)}
                    className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-full disabled:opacity-50 hover:bg-primary-dark transition-colors duration-150 flex-shrink-0 flex items-center gap-1.5"
                  >
                    {assigningId === c.driver_id && <Loader2 size={12} className="animate-spin" />}
                    Select
                  </button>
                </div>
                {assignError?.id === c.driver_id && (
                  <p className="px-3 pb-2 -mt-1 text-xs text-danger">{assignError.message}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && !fetchError && excluded.length > 0 && (
          <div className="px-2 pb-2">
            <button
              onClick={() => setShowExcluded(v => !v)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-muted hover:text-text-primary transition-colors duration-150"
            >
              <ChevronDown size={13} className={`transition-transform duration-150 ${showExcluded ? 'rotate-180' : ''}`} />
              {excluded.length} more driver{excluded.length === 1 ? '' : 's'} not shown (offline, wrong category, or low balance)
            </button>
            <AnimatePresence>
              {showExcluded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduce ? 0.01 : 0.2 }}
                  className="overflow-hidden"
                >
                  {excluded.map(c => {
                    const reason = exclusionReason(c)
                    return (
                      <div key={c.driver_id} className="rounded-xl">
                        <div className="flex items-center justify-between px-3 py-3 opacity-70">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate">{c.driver_name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={reason.tone === 'muted' ? 'pill-muted' : 'pill-warning'}>{reason.label}</span>
                              {c.distance_metres != null && (
                                <span className="text-xs text-text-muted">{(c.distance_metres / 1000).toFixed(1)} km</span>
                              )}
                            </div>
                          </div>
                          <button
                            disabled={assigningId === c.driver_id}
                            onClick={() => handleSelectExcluded(c)}
                            className="px-3 py-1.5 text-xs font-semibold bg-surface-2 text-text-primary rounded-full disabled:opacity-50 hover:bg-border transition-colors duration-150 flex-shrink-0 flex items-center gap-1.5"
                          >
                            {assigningId === c.driver_id && <Loader2 size={12} className="animate-spin" />}
                            Select anyway
                          </button>
                        </div>
                        <AnimatePresence>
                          {confirmingId === c.driver_id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: reduce ? 0.01 : 0.2 }}
                              className="px-3 pb-3 overflow-hidden"
                            >
                              <div className="px-3 py-2 rounded-lg bg-warning-light text-warning text-xs flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5">
                                  <AlertTriangle size={13} className="flex-shrink-0" />
                                  {c.driver_name} is {reason.label.toLowerCase()} — assign anyway?
                                </span>
                                <button
                                  disabled={assigningId === c.driver_id}
                                  onClick={() => handleSelectExcluded(c)}
                                  className="px-2 py-1 rounded-full bg-warning text-white font-semibold flex-shrink-0"
                                >
                                  Confirm
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        {assignError?.id === c.driver_id && (
                          <p className="px-3 pb-2 -mt-1 text-xs text-danger">{assignError.message}</p>
                        )}
                      </div>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </SlideOver>
  )
}
