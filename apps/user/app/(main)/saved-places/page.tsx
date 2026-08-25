'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowLeft, MapPin, Home, Briefcase, Plus, X, Check, Trash2, Clock } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { savedPlacesApi, type SavedPlace, type SavedPlaceKind } from '@/lib/saved-places-api'
import { geoApi, type PlaceSuggestion } from '@/lib/geo-api'

const EASE = [0.22, 1, 0.36, 1] as const

type Resolved = { address: string; latitude: number; longitude: number }
type SheetState = { presetKind: SavedPlaceKind; editing: SavedPlace | null }

export default function SavedPlacesPage() {
  const router = useRouter()
  const reduce = useReducedMotion()

  const [places, setPlaces] = useState<SavedPlace[] | null>(null)
  const [sheet, setSheet] = useState<SheetState | null>(null)

  const load = () => { savedPlacesApi.list().then(setPlaces).catch(() => setPlaces([])) }
  useEffect(() => { load() }, [])

  const home  = places?.find(p => p.kind === 'home') ?? null
  const work  = places?.find(p => p.kind === 'work') ?? null
  const other = places?.filter(p => p.kind === 'other') ?? []

  const closeSheet = () => setSheet(null)
  const onSaved = () => { closeSheet(); load() }

  return (
    <div className="h-full flex flex-col bg-background">
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b border-slate-100"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 12 }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
        </button>
        <p className="text-[15px] font-bold text-slate-900">Saved places</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        {places === null ? (
          <div className="flex items-center justify-center py-16">
            <OcarSpinner size={28} variant="color" />
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">Your places</p>
            <div className="card p-0 overflow-hidden">
              <PlaceRow
                Icon={Home}
                label="Home"
                sub={home ? home.address : 'Add your home address'}
                onClick={() => setSheet({ presetKind: 'home', editing: home })}
              />
              <PlaceRow
                Icon={Briefcase}
                label="Work"
                sub={work ? work.address : 'Add your work address'}
                onClick={() => setSheet({ presetKind: 'work', editing: work })}
                divider
              />
              {other.map(p => (
                <PlaceRow
                  key={p.id}
                  Icon={MapPin}
                  label={p.label}
                  sub={p.address}
                  onClick={() => setSheet({ presetKind: 'other', editing: p })}
                  divider
                />
              ))}
              <PlaceRow
                Icon={Plus}
                label="Add a place"
                sub="Gym, a friend's house, anywhere"
                onClick={() => setSheet({ presetKind: 'other', editing: null })}
                divider
              />
            </div>
          </>
        )}
      </div>

      <PlaceSheet state={sheet} reduce={!!reduce} onClose={closeSheet} onSaved={onSaved} />
    </div>
  )
}

function PlaceRow({
  Icon, label, sub, onClick, divider,
}: {
  Icon: typeof Home
  label: string
  sub: string
  onClick: () => void
  divider?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${divider ? ' border-t border-border' : ''}`}
    >
      <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
        <Icon size={15} strokeWidth={1.6} className="text-text-muted" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-text-primary">{label}</span>
        <span className="block text-xs text-text-muted mt-0.5 truncate">{sub}</span>
      </span>
    </button>
  )
}

function PlaceSheet({
  state, reduce, onClose, onSaved,
}: {
  state: SheetState | null
  reduce: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState('')
  // `text` is what the input displays; `picked` is only set once a suggestion
  // resolves to real coordinates. Kept as one state so the two can never drift
  // out of sync with each other (they used to be separate useStates).
  const [address, setAddress] = useState<{ text: string; picked: Resolved | null }>({ text: '', picked: null })
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!state) return
    const { editing, presetKind } = state
    setLabel(presetKind === 'other' ? (editing?.label ?? '') : '')
    setAddress({
      text: editing?.address ?? '',
      picked: editing ? { address: editing.address, latitude: editing.latitude, longitude: editing.longitude } : null,
    })
    setSuggestions([])
    setError(null)
  }, [state])

  if (!state) return null
  const { presetKind, editing } = state
  const needsLabel = presetKind === 'other'
  const title = editing ? `Edit ${presetKind === 'other' ? editing.label : presetKind === 'home' ? 'Home' : 'Work'}` : presetKind === 'other' ? 'Add a place' : `Add ${presetKind === 'home' ? 'home' : 'work'} address`

  function handleQueryChange(val: string) {
    setAddress({ text: val, picked: null })
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!val || val.length < 2) return
    setSearching(true)
    debounceRef.current = setTimeout(() => {
      geoApi.autocomplete(val).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setSearching(false))
    }, 300)
  }

  async function pickSuggestion(s: PlaceSuggestion) {
    setSuggestions([])
    try {
      const detail = await geoApi.placeDetails(s.placeId)
      setAddress({ text: detail.address, picked: { address: detail.address, latitude: detail.latitude, longitude: detail.longitude } })
    } catch {
      // leave the typed text as-is; save stays disabled until a valid pick resolves
    }
  }

  async function save() {
    const picked = address.picked
    if (!picked) return
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await savedPlacesApi.update(editing.id, { label: needsLabel ? label.trim() : undefined, address: picked.address, latitude: picked.latitude, longitude: picked.longitude })
      } else {
        await savedPlacesApi.create({ kind: presetKind, label: needsLabel ? label.trim() : undefined, address: picked.address, latitude: picked.latitude, longitude: picked.longitude })
      }
      onSaved()
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Could not save this place' : 'Could not save this place')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await savedPlacesApi.remove(editing.id)
      onSaved()
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Could not remove this place' : 'Could not remove this place')
    } finally {
      setSaving(false)
    }
  }

  const canSave = address.picked !== null && (!needsLabel || label.trim().length > 0)

  return (
    <AnimatePresence>
      <motion.div
        key="places-backdrop"
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(15,23,42,0.48)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0.01 : 0.2 }}
        onClick={onClose}
      />
      <motion.div
        key="places-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed bottom-0 left-0 right-0 z-50 bg-white overflow-hidden"
        style={{
          borderRadius: '32px 32px 0 0',
          boxShadow: '0 -6px 32px rgba(10,159,176,0.10)',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
        }}
        initial={reduce ? { opacity: 0 } : { y: '100%' }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: '100%' }}
        transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 40 }}
      >
        <div className="w-9 h-1 rounded-full mx-auto mt-3 mb-4" style={{ background: 'rgba(10,159,176,0.15)' }} />

        <div className="flex items-center justify-between px-6 mb-4">
          <p className="text-[18px] font-bold text-text-primary" style={{ letterSpacing: '-0.01em' }}>{title}</p>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center active:bg-black/[0.04]">
            <X size={16} className="text-text-muted" />
          </button>
        </div>

        <div className="px-6 flex flex-col gap-3 max-h-[52vh] overflow-y-auto scrollbar-none">
          {needsLabel && (
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Label, e.g. Gym"
              maxLength={60}
              className="w-full px-4 rounded-2xl text-[15px] font-medium outline-none placeholder:text-text-muted focus:ring-2 focus:ring-primary/30 transition-shadow duration-150"
              style={{ background: '#F5F7FF', height: 52 }}
            />
          )}
          <input
            value={address.text}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search address"
            className="w-full px-4 rounded-2xl text-[15px] font-medium outline-none placeholder:text-text-muted focus:ring-2 focus:ring-primary/30 transition-shadow duration-150"
            style={{ background: '#F5F7FF', height: 52 }}
          />

          {searching && (
            <div className="flex justify-center py-2"><OcarSpinner size={16} variant="color" /></div>
          )}

          {suggestions.length > 0 && (
            <div>
              {suggestions.map((s, i) => (
                <div key={s.placeId}>
                  <button
                    onClick={() => void pickSuggestion(s)}
                    className="w-full flex items-center gap-3 px-1 py-3 text-left"
                  >
                    <span className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                      <Clock size={16} className="text-text-muted" strokeWidth={1.6} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-text-primary truncate">{s.mainText}</span>
                      {s.secondaryText && (
                        <span className="block text-[11px] text-text-muted truncate mt-0.5">{s.secondaryText}</span>
                      )}
                    </span>
                  </button>
                  {i < suggestions.length - 1 && <div className="ml-12 border-t border-dashed border-border" />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 pt-4 flex flex-col gap-2">
          {error && <p className="text-xs text-status-error text-center">{error}</p>}
          <button
            onClick={() => void save()}
            disabled={!canSave || saving}
            className="w-full py-4 rounded-full text-[15px] font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)',
              boxShadow: '0 4px 20px rgba(10,159,176,0.40)',
              minHeight: 52,
            }}
          >
            <Check size={14} className="inline mr-1.5 -mt-0.5" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          {editing && (
            <button
              onClick={() => void remove()}
              disabled={saving}
              className="w-full py-3 rounded-full text-[14px] font-semibold text-status-error active:scale-[0.98] transition-transform disabled:opacity-40 cursor-pointer"
            >
              <Trash2 size={13} className="inline mr-1.5 -mt-0.5" />
              Remove place
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
