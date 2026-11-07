'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { UserCheck } from 'lucide-react'
import { verificationApi, type ReviewCase, type ReviewListItem } from '@/lib/verification-api'
import {
  bandFor, budgetTone, kindLabel, nextSelection, reasonText, reviewKey, similarityText,
} from '@/lib/verification-model'
import { cn } from '@/lib/utils'

type Tab = 'queued' | 'resolved_today'

const TONE_CLASS = {
  success: 'pill-success',
  warning: 'pill-warning',
  danger: 'pill-danger',
  muted: 'pill-muted',
} as const

function Chip({ decision }: { decision: ReviewListItem['decision'] }) {
  const b = bandFor(decision)
  return <span className={cn('pill', TONE_CLASS[b.tone])}>{b.label}</span>
}

function errorCode(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
}

export default function VerificationsPage() {
  const [tab, setTab] = useState<Tab>('queued')
  const [items, setItems] = useState<ReviewListItem[]>([])
  const [budget, setBudget] = useState(30)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewCase | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [note, setNote] = useState('')
  const [addReference, setAddReference] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [zoom, setZoom] = useState<string | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const retriedImages = useRef(false)

  const loadList = useCallback(async (keep?: string | null) => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await verificationApi.list(tab)
      setItems(res.items)
      setBudget(res.budget)
      setSelectedId((cur) => {
        const want = keep === undefined ? cur : keep
        return want && res.items.some((i) => i.id === want) ? want : (res.items[0]?.id ?? null)
      })
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void loadList(null) }, [loadList])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(false)
    try {
      setDetail(await verificationApi.get(id))
    } catch {
      setDetail(null)
      setDetailError(true)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    setNote('')
    setAddReference(false)
    setMessage('')
    retriedImages.current = false
    if (selectedId) void loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  const ids = useMemo(() => items.map((i) => i.id), [items])
  const canResolve = tab === 'queued' && !!detail && detail.reviewState === 'queued' && !busy

  const resolve = useCallback(async (outcome: 'ok' | 'mismatch') => {
    if (!detail || !canResolve) return
    if (outcome === 'mismatch' && !note.trim()) {
      noteRef.current?.focus()
      setMessage('Add a short note for a mismatch.')
      return
    }
    setBusy(true)
    setMessage('')
    const id = detail.id
    try {
      const body: { outcome: 'ok' | 'mismatch'; note?: string; add_reference?: boolean } = { outcome }
      if (note.trim()) body.note = note.trim()
      if (outcome === 'ok' && addReference && kindLabel(detail.kind) === 'Selfie') body.add_reference = true
      await verificationApi.resolve(id, body)
      const next = nextSelection(ids, id)
      setItems((cur) => cur.filter((i) => i.id !== id))
      setSelectedId(next)
    } catch (err) {
      if (errorCode(err) === 'ALREADY_RESOLVED') {
        setMessage('Another admin already resolved this case.')
        await loadList(null) // refresh quietly; the case is gone from the queue
      } else {
        setMessage("Couldn't save that decision. Try again.")
      }
    } finally {
      setBusy(false)
    }
  }, [detail, canResolve, note, addReference, ids, loadList])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = reviewKey(e)
      if (!k) return
      if (k === 'next' || k === 'prev') {
        const i = selectedId ? ids.indexOf(selectedId) : -1
        const to = ids[k === 'next' ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0)]
        if (to) { e.preventDefault(); setSelectedId(to) }
      } else {
        e.preventDefault()
        void resolve(k)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, selectedId, resolve])

  // Photo links expire after an hour: on an image error ask for fresh links once, then stop.
  const onImageError = () => {
    if (retriedImages.current || !selectedId) return
    retriedImages.current = true
    void loadDetail(selectedId)
  }

  const waiting = tab === 'queued' ? items.length : 0
  const over = budgetTone(waiting, budget) === 'over'

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-text-primary">Verifications</h1>
          <p className="text-sm text-text-muted">Driver selfie and number plate checks that need a person to look.</p>
        </div>
        <div className="flex items-center gap-2" role="tablist" aria-label="Case filter">
          <button role="tab" aria-selected={tab === 'queued'} onClick={() => setTab('queued')}
            className={cn('btn-secondary', tab === 'queued' && 'ring-2 ring-primary')}>
            Needs review{tab === 'queued' ? ` ${items.length}` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'resolved_today'} onClick={() => setTab('resolved_today')}
            className={cn('btn-secondary', tab === 'resolved_today' && 'ring-2 ring-primary')}>
            Resolved today
          </button>
          {tab === 'queued' ? (
            <span className={cn('pill', over ? 'pill-warning' : 'pill-muted')} aria-live="polite">
              {waiting} waiting / budget {budget}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-[32rem] flex-col gap-4 lg:flex-row">
        {/* Queue list */}
        <section aria-label="Cases" className="panel w-full overflow-y-auto lg:w-80 lg:shrink-0">
          {loading ? (
            <ul aria-busy="true">{[0, 1, 2, 3, 4].map((n) => (
              <li key={n} className="m-3 h-12 animate-pulse rounded-lg bg-surface-2" />
            ))}</ul>
          ) : loadError ? (
            <div className="p-6 text-center text-sm">
              <p className="mb-3 text-text-muted">Couldn&apos;t load the queue.</p>
              <button className="btn-primary" onClick={() => void loadList()}>Retry</button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <UserCheck className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden />
              <p className="font-medium text-text-primary">All caught up</p>
              <p className="text-sm text-text-muted">{tab === 'queued' ? 'Nothing is waiting for review.' : 'Nothing resolved yet today.'}</p>
            </div>
          ) : (
            <ul role="listbox" aria-label="Cases to review">
              {items.map((it) => (
                <li key={it.id} role="option" aria-selected={it.id === selectedId}>
                  <button
                    onClick={() => setSelectedId(it.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left',
                      it.id === selectedId ? 'bg-primary-light' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">{it.driverName ?? it.driverPhone}</span>
                      <span className="block text-xs text-text-muted">{kindLabel(it.kind)} · {it.driverPhone}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Chip decision={it.decision} />
                      <span className="w-9 text-right text-xs tabular-nums text-text-muted">{similarityText(it.similarity)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Case */}
        <section aria-label="Case" className="panel flex-1 p-5">
          {!selectedId ? (
            <p className="text-sm text-text-muted">Pick a case.</p>
          ) : detailLoading && !detail ? (
            <div className="flex gap-4" aria-busy="true">
              <div className="h-64 flex-1 animate-pulse rounded-xl bg-surface-2" />
              <div className="h-64 flex-1 animate-pulse rounded-xl bg-surface-2" />
            </div>
          ) : detailError || !detail ? (
            <div className="text-sm">
              <p className="mb-3 text-text-muted">Couldn&apos;t load this case.</p>
              <button className="btn-primary" onClick={() => selectedId && void loadDetail(selectedId)}>Reload</button>
            </div>
          ) : (
            <CaseView
              c={detail}
              note={note} setNote={setNote} noteRef={noteRef}
              addReference={addReference} setAddReference={setAddReference}
              busy={busy} canResolve={canResolve} message={message}
              onResolve={resolve} onZoom={setZoom} onImageError={onImageError}
            />
          )}
        </section>
      </div>

      <p className="text-xs text-text-muted">Keys: J / K move between cases, O looks fine, M mismatch.</p>

      {zoom ? (
        <button
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(null)} aria-label="Close enlarged photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Enlarged photo" className="max-h-full max-w-full rounded-xl" />
        </button>
      ) : null}
    </div>
  )
}

function CaseView(props: {
  c: ReviewCase
  note: string; setNote: (v: string) => void; noteRef: React.RefObject<HTMLTextAreaElement | null>
  addReference: boolean; setAddReference: (v: boolean) => void
  busy: boolean; canResolve: boolean; message: string
  onResolve: (o: 'ok' | 'mismatch') => void
  onZoom: (url: string) => void
  onImageError: () => void
}) {
  const { c } = props
  const isSelfie = kindLabel(c.kind) === 'Selfie'
  const photo = (url: string, label: string) => (
    <figure className="flex-1">
      <button onClick={() => props.onZoom(url)} className="block w-full" aria-label={`Enlarge ${label}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} onError={props.onImageError}
          className="aspect-square w-full rounded-xl border border-border bg-surface-2 object-cover" />
      </button>
      <figcaption className="mt-1 text-xs text-text-muted">{label}</figcaption>
    </figure>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{c.driverName ?? c.driverPhone}</h2>
        <span className="text-sm text-text-muted">{kindLabel(c.kind)} · {c.driverPhone}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        {photo(c.imageUrl, 'New photo')}
        {isSelfie
          ? (c.referenceUrls[0]
              ? photo(c.referenceUrls[0], 'Reference photo')
              : <p className="flex-1 text-sm text-text-muted">No reference photo on file.</p>)
          : (
            <div className="flex-1 rounded-xl bg-surface-2 p-4 text-sm">
              <p className="text-text-muted">Registered plate</p>
              <p className="font-mono text-lg text-text-primary">{c.registeredPlate ?? '-'}</p>
              <p className="mt-3 text-text-muted">Read from the photo</p>
              <p className="font-mono text-lg text-text-primary">{c.ocrText ?? 'nothing readable'}</p>
            </div>
          )}
      </div>
      {isSelfie && c.referenceUrls.length > 1 ? (
        <div className="flex gap-3">{c.referenceUrls.slice(1).map((u, i) => (
          <div key={u} className="w-24">{photo(u, `Confirmed photo ${i + 1}`)}</div>
        ))}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Chip decision={c.decision} />
        {isSelfie ? <span className="text-sm text-text-primary">Similarity {similarityText(c.similarity)}</span> : null}
        <span className="text-sm text-text-muted">{reasonText(c.decisionReason)}</span>
      </div>

      <div>
        <p className="mb-1 text-xs text-text-muted">Last 10 outcomes</p>
        <div className="flex flex-wrap gap-1">
          {c.history.map((h) => (
            <span key={h.id} className="inline-flex items-center gap-1">
              <Chip decision={h.decision} />
            </span>
          ))}
        </div>
      </div>

      {props.canResolve ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <label className="text-sm text-text-primary" htmlFor="verif-note">Note (required for a mismatch)</label>
          <textarea id="verif-note" ref={props.noteRef} value={props.note} maxLength={500} rows={2}
            onChange={(e) => props.setNote(e.target.value)}
            className="w-full rounded-lg border border-border p-2 text-sm" />
          {isSelfie ? (
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={props.addReference} onChange={(e) => props.setAddReference(e.target.checked)} />
              Use this photo as a reference for this driver
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={props.busy} onClick={() => props.onResolve('ok')}>
              Looks fine <kbd className="ml-1 rounded bg-white/20 px-1 text-xs">O</kbd>
            </button>
            <button className="btn-danger" disabled={props.busy} onClick={() => props.onResolve('mismatch')}>
              Mismatch <kbd className="ml-1 rounded bg-white/20 px-1 text-xs">M</kbd>
            </button>
            {props.message ? <span role="status" className="text-sm text-text-muted">{props.message}</span> : null}
          </div>
        </div>
      ) : (
        <p className="border-t border-border pt-4 text-sm text-text-muted">
          {c.reviewState === 'confirmed_ok' ? 'Resolved: looks fine.' : c.reviewState === 'confirmed_mismatch' ? 'Resolved: mismatch.' : ''}
        </p>
      )}
    </div>
  )
}
