'use client'

import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawGoogleMapsAdapter } from 'terra-draw-google-maps-adapter'
import { X, Undo2, Trash2, Loader2, AlertTriangle, MapPin } from 'lucide-react'
import { boundaryApi, type CityBoundaryGeoJson, type CityBoundaryAnalysis } from '@/lib/boundary-api'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { extractErrorMessage, extractErrorCode } from '@/lib/http-errors'
import { parsePastedPolygon, sameShape, boundaryWarnings } from '@/lib/boundary-utils'
import { saveDraft, loadDraft, clearDraft } from '@/lib/boundary-draft'

// BoundaryEditor: admin "Edit boundary" dialog. Implements the 9 design
// decisions from docs/superpowers/specs/2026-09-25-admin-city-boundary-
// editor-plan.md's design review (map-primary layout, live status strip,
// 409-conflict recovery, empty state, save-success/undo banner, stakes-
// visible Save + typed Delete confirm, read-only overlays, DESIGN.md
// tokens, keyboard-accessible non-map controls). Map vertex drawing/editing
// itself is mouse-only — decision 8's accepted, documented gap.

const PREVIEW_DEBOUNCE_MS = 400
const DRAFT_DEBOUNCE_MS = 500

function timeAgo(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

function toClosedRing(feature: { geometry: { coordinates: unknown } }): CityBoundaryGeoJson {
  return { type: 'Polygon', coordinates: feature.geometry.coordinates as [number, number][][] }
}

// Terra Draw only accepts a feature whose properties.mode names one of its modes
// and that passes its geometry validation — otherwise addFeatures() silently
// returns { valid: false } and the map stays empty. Always check the result.
function addBoundaryFeature(draw: TerraDraw, geojson: CityBoundaryGeoJson): string | null {
  const results = draw.addFeatures([{ type: 'Feature', properties: { mode: 'polygon' }, geometry: geojson }])
  const bad = results.find(r => !r.valid)
  return bad ? (bad.reason ?? 'This shape could not be loaded into the editor.') : null
}

// ── Map layer: Terra Draw (editable) + read-only overlays of other cities ──

function BoundaryMapLayer({
  cityId,
  initialBoundary,
  overlays,
  onChange,
  onError,
  loadFeatureRef,
}: {
  cityId: number
  initialBoundary: CityBoundaryGeoJson | null
  overlays: Array<{ id: number; name: string; boundary: CityBoundaryGeoJson }>
  onChange: (geojson: CityBoundaryGeoJson | null) => void
  onError: (message: string) => void
  // Returns an error message, or null on success.
  loadFeatureRef: MutableRefObject<((geojson: CityBoundaryGeoJson) => string | null) | null>
}) {
  const map = useMap()
  const drawRef = useRef<TerraDraw | null>(null)
  const overlayPolysRef = useRef<google.maps.Polygon[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Init Terra Draw once the underlying google.maps.Map exists.
  useEffect(() => {
    if (!map || typeof google === 'undefined') return

    let active: TerraDraw | null = null
    let cancelled = false

    const init = () => {
      if (cancelled) return
      const draw = new TerraDraw({
        adapter: new TerraDrawGoogleMapsAdapter({ lib: google.maps, map }),
        modes: [
          new TerraDrawPolygonMode({
            styles: {
              fillColor: '#4F46E5', fillOpacity: 0.15,
              outlineColor: '#4F46E5', outlineWidth: 2, outlineOpacity: 1,
              closingPointColor: '#4F46E5', closingPointWidth: 6, closingPointOutlineColor: '#FFFFFF', closingPointOutlineWidth: 2,
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
            },
            styles: {
              selectedPolygonColor: '#4F46E5', selectedPolygonFillOpacity: 0.15,
              selectedPolygonOutlineColor: '#4F46E5', selectedPolygonOutlineWidth: 2,
              selectionPointColor: '#4F46E5', selectionPointWidth: 6, selectionPointOutlineColor: '#FFFFFF', selectionPointOutlineWidth: 2,
              midPointColor: '#C7D2FE', midPointWidth: 5, midPointOutlineColor: '#FFFFFF', midPointOutlineWidth: 2,
            },
          }),
        ],
      })
      drawRef.current = draw
      active = draw
      const emit = () => {
        const [feature] = draw.getSnapshot()
        onChangeRef.current(feature ? toClosedRing(feature as { geometry: { coordinates: unknown } }) : null)
      }

      // The Google adapter can't project lng/lat until it fires 'ready' (its overlay
      // has to attach first); adding the existing shape before that throws
      // "cannot get projection" and leaves the editor un-checked. Load on 'ready'.
      draw.on('ready', () => {
        if (cancelled) return
        const loadError = initialBoundary ? addBoundaryFeature(draw, initialBoundary) : null
        if (initialBoundary && !loadError) {
          draw.setMode('select')
          const [feature] = draw.getSnapshot()
          if (feature) draw.selectFeature(feature.id!)
          emit() // run the live check on the existing shape straight away
        } else {
          draw.setMode('polygon')
          if (loadError) onErrorRef.current(`Could not load the existing boundary: ${loadError}`)
        }
      })
      draw.start()

      draw.on('finish', () => { draw.setMode('select'); emit() })
      draw.on('change', emit)

      // Paste-GeoJSON path: replaces whatever is drawn with the pasted shape,
      // selected and editable — decision 1's "Paste GeoJSON instead" toggle.
      loadFeatureRef.current = (geojson) => {
        draw.clear()
        const error = addBoundaryFeature(draw, geojson)
        if (error) return error
        draw.setMode('select')
        const [feature] = draw.getSnapshot()
        if (feature) draw.selectFeature(feature.id!)
        emit()
        return null
      }
    }

    // Terra Draw's Google adapter needs BOTH the map's inner DOM (.gm-style, for its
    // event listeners) and the map projection (for lng/lat <-> pixel). Google provides
    // each a beat after useMap() hands back the instance; starting earlier throws
    // "Cannot read properties of null (reading 'addEventListener')" / "cannot get
    // projection" and leaves the editor half-initialised. Start on whichever signal
    // first finds both present — 'idle' alone is unreliable (it can be delayed
    // indefinitely in a slow or software-rendered browser).
    const mapDiv = map.getDiv()
    const isReady = () => Boolean(map.getProjection() && mapDiv.querySelector('.gm-style'))
    const listeners: google.maps.MapsEventListener[] = []
    let observer: MutationObserver | null = null
    const stopWaiting = () => {
      observer?.disconnect()
      listeners.forEach(l => l.remove())
      listeners.length = 0
    }
    const startWhenReady = () => {
      if (cancelled || !isReady()) return
      stopWaiting()
      init()
    }
    if (isReady()) {
      init()
    } else {
      observer = new MutationObserver(startWhenReady)
      observer.observe(mapDiv, { childList: true, subtree: true })
      listeners.push(map.addListener('projection_changed', startWhenReady), map.addListener('idle', startWhenReady))
    }

    return () => {
      cancelled = true
      stopWaiting()
      active?.stop()
      drawRef.current = null
      loadFeatureRef.current = null
    }
    // cityId in deps: re-init the whole draw session when switching cities
    // (dialog is remounted per-city in practice, but guards re-entry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cityId])

  // Read-only overlays for every other city — plain google.maps.Polygon,
  // outside Terra Draw entirely, so they're never selectable/editable.
  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    overlayPolysRef.current.forEach(p => p.setMap(null))
    overlayPolysRef.current = overlays.map(o => {
      const poly = new google.maps.Polygon({
        paths: o.boundary.coordinates[0]!.map(([lng, lat]) => ({ lat, lng })),
        strokeColor: '#94A3B8', strokeWeight: 2, strokeOpacity: 0.9,
        // clickable must stay true for mousemove/mouseout to fire at all
        // (Google Maps fires no mouse events on a clickable:false polygon —
        // this is unrelated to Terra Draw editability: these polygons live
        // entirely outside the Terra Draw instance, so they can never be
        // selected/dragged/edited by it regardless of this flag).
        fillOpacity: 0, clickable: true, zIndex: 1,
      })
      poly.setMap(map)
      // Set via a plain-text DOM node, not a raw string — InfoWindow renders
      // a string `content` as HTML, and city names are free-text admin input
      // with no format validation (admin.service.ts's createAdminCity only
      // checks non-empty) — a raw string here is a stored-XSS vector.
      const label = document.createElement('div')
      label.textContent = o.name
      const info = new google.maps.InfoWindow({ content: label, disableAutoPan: true })
      poly.addListener('mousemove', (e: google.maps.PolyMouseEvent) => {
        if (e.latLng) info.setPosition(e.latLng)
        info.open({ map })
      })
      poly.addListener('mouseout', () => info.close())
      return poly
    })
    return () => { overlayPolysRef.current.forEach(p => p.setMap(null)) }
  }, [map, overlays])

  return null
}

// ── Status strip ────────────────────────────────────────────────────────────

function StatusStrip({
  hasShape, analysis, previewing,
}: {
  hasShape: boolean
  analysis: CityBoundaryAnalysis | null
  previewing: boolean
}) {
  if (!hasShape) {
    return (
      <div className="admin-card !p-4" role="status">
        <p className="text-sm font-semibold text-text-primary">No boundary yet</p>
        <p className="text-xs text-text-muted mt-1">Click the map to place points, then click the first point to finish the shape.</p>
      </div>
    )
  }

  const pill = previewing
    ? <span className="pill-muted">Checking…</span>
    : !analysis
      ? <span className="pill-muted">Not previewed</span>
      : analysis.isValid
        ? <span className="pill-success">Valid</span>
        : <span className="pill-danger">Invalid</span>

  return (
    <div className="admin-card !p-4 space-y-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Shape</span>
        {pill}
      </div>
      {analysis && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-text-muted text-xs">Vertices</p>
            <p className="font-mono text-text-primary">{analysis.vertexCount}</p>
          </div>
          <div>
            <p className="text-text-muted text-xs">Area</p>
            <p className="font-mono text-text-primary">{analysis.areaKm2.toFixed(1)} km²</p>
          </div>
        </div>
      )}
      {analysis && !analysis.isValid && analysis.invalidReason && (
        <p className="text-xs text-danger flex gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{analysis.invalidReason}</p>
      )}
      {analysis?.isValid && analysis.centroidInside === false && (
        <p className="text-xs text-warning flex gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />This city&apos;s own centroid falls outside the shape.</p>
      )}
      {analysis?.isValid && analysis.overlaps.length > 0 && (
        <div className="text-xs text-warning space-y-1">
          {analysis.overlaps.map(o => (
            <p key={o.cityId} className="flex gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />Overlaps {o.name} ({o.pctOfNew}%)</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main dialog ──────────────────────────────────────────────────────────────

export default function BoundaryEditor({ city }: { city: AdminCity }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [boundary, setBoundary] = useState<CityBoundaryGeoJson | null>(null)
  const [updatedAt, setUpdatedAt] = useState('')
  const [draft, setDraft] = useState<CityBoundaryGeoJson | null>(null)
  const [overlays, setOverlays] = useState<Array<{ id: number; name: string; boundary: CityBoundaryGeoJson }>>([])
  const [analysis, setAnalysis] = useState<CityBoundaryAnalysis | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<{ updatedAt: string } | null>(null)
  const [savedBanner, setSavedBanner] = useState<{ previousBoundary: CityBoundaryGeoJson | null } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [confirmWarnings, setConfirmWarnings] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  // A browser-local draft found on open, waiting for Resume/Discard.
  const [resumable, setResumable] = useState<{ polygon: CityBoundaryGeoJson; stale: boolean; savedAt: number } | null>(null)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [persistFailed, setPersistFailed] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewSeqRef = useRef(0)
  const loadFeatureRef = useRef<((geojson: CityBoundaryGeoJson) => string | null) | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [own, allCities] = await Promise.all([boundaryApi.get(city.id), cityApi.list()])
      setBoundary(own.boundary)
      setDraft(own.boundary)
      setUpdatedAt(own.updatedAt)
      const saved = loadDraft(city.id)
      if (saved && sameShape(saved.polygon, own.boundary)) clearDraft(city.id) // nothing left to recover
      setResumable(saved && !sameShape(saved.polygon, own.boundary)
        ? { polygon: saved.polygon, stale: saved.baseUpdatedAt !== own.updatedAt, savedAt: saved.savedAt }
        : null)
      setAnalysis(null)
      setSavedBanner(null)
      const others = allCities.filter(c => c.id !== city.id)
      const fetched = await Promise.all(
        others.map(c => boundaryApi.get(c.id).then(r => (r.boundary ? { id: c.id, name: c.name, boundary: r.boundary } : null)))
      )
      setOverlays(fetched.filter((o): o is { id: number; name: string; boundary: CityBoundaryGeoJson } => o !== null))
    } catch {
      setError('Failed to load boundary.')
    } finally {
      setLoading(false)
    }
  }, [city.id])

  useEffect(() => { if (open) void load() }, [open, load])

  // Decision 9: Save always re-runs the same analysis Preview does. Here we
  // run it live (debounced) on every draw change too, so the status strip
  // never goes stale while drawing — this IS the "Preview" action; there's
  // no separate button for it.
  const runPreview = useCallback((geojson: CityBoundaryGeoJson | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const seq = ++previewSeqRef.current
    setPreviewError('')
    if (!geojson) { setAnalysis(null); setPreviewing(false); return }
    setPreviewing(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await boundaryApi.preview(city.id, geojson)
        // Ignore a slow response that a newer edit has already superseded.
        if (seq === previewSeqRef.current) setAnalysis(result)
      } catch (err) {
        if (seq === previewSeqRef.current) {
          setAnalysis(null)
          // e.g. 422 for a shape outside the service region — tell the admin why.
          setPreviewError(extractErrorMessage(err, 'Could not check this shape. Try again.'))
        }
      } finally {
        if (seq === previewSeqRef.current) setPreviewing(false)
      }
    }, PREVIEW_DEBOUNCE_MS)
  }, [city.id])

  // Cancel any pending preview when the dialog unmounts / closes.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    previewSeqRef.current++
  }, [])

  const handleDrawChange = useCallback((geojson: CityBoundaryGeoJson | null) => {
    setDraft(geojson)
    setConflict(null)
    setConfirmWarnings(false)
    runPreview(geojson)
  }, [runPreview])

  const handlePasteLoad = () => {
    const result = parsePastedPolygon(pasteText)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }
    const loadError = loadFeatureRef.current?.(result.polygon) ?? null
    if (loadError) {
      setPasteError(loadError)
      return
    }
    setPasteError('')
    setPasteOpen(false)
    setPasteText('')
  }

  // A stale save/delete: fetch the server's current version so the admin can
  // choose Overwrite vs Discard. If even that fetch fails, say so — never let
  // the rejection escape the click handler unhandled.
  const enterConflict = async () => {
    try {
      const fresh = await boundaryApi.get(city.id)
      setConflict({ updatedAt: fresh.updatedAt })
    } catch (err) {
      setError(extractErrorMessage(err, 'Someone else changed this boundary and the latest version could not be loaded. Close and reopen the editor.'))
    }
  }

  const doSave = async (targetUpdatedAt: string) => {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      const result = await boundaryApi.save(city.id, draft, targetUpdatedAt)
      setBoundary(result.boundary)
      // Also sync draft to the server's canonical (round-tripped) shape —
      // otherwise shapeChanged stays true forever after a successful save
      // (draft still holds the pre-save client shape, which can differ from
      // the server's ST_AsGeoJSON output by coordinate precision alone),
      // leaving Save clickable with nothing left to save.
      setDraft(result.boundary)
      setUpdatedAt(result.updatedAt)
      setSavedBanner({ previousBoundary: result.previousBoundary })
      setConflict(null)
      clearDraft(city.id)
    } catch (err) {
      if (extractErrorCode(err) === 'BOUNDARY_CHANGED') {
        await enterConflict()
      } else {
        setError(extractErrorMessage(err, 'Failed to save boundary.'))
      }
    } finally {
      setSaving(false)
    }
  }

  const handleUndo = async () => {
    if (!savedBanner) return
    setSaving(true)
    setError('')
    try {
      if (savedBanner.previousBoundary) {
        const result = await boundaryApi.save(city.id, savedBanner.previousBoundary, updatedAt)
        setBoundary(result.boundary)
        setDraft(result.boundary)
        setUpdatedAt(result.updatedAt)
      } else {
        const result = await boundaryApi.remove(city.id, updatedAt)
        setBoundary(null)
        setDraft(null)
        setUpdatedAt(result.updatedAt)
      }
      setSavedBanner(null)
      setAnalysis(null)
      clearDraft(city.id)
    } catch (err) {
      setError(extractErrorMessage(err, 'Undo failed — refresh and try again.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await boundaryApi.remove(city.id, updatedAt)
      setBoundary(null)
      setDraft(null)
      setUpdatedAt(result.updatedAt)
      setSavedBanner({ previousBoundary: result.previousBoundary })
      setAnalysis(null)
      setDeleteOpen(false)
      setDeleteConfirmText('')
      clearDraft(city.id)
    } catch (err) {
      if (extractErrorCode(err) === 'BOUNDARY_CHANGED') {
        setDeleteOpen(false)
        await enterConflict()
      } else {
        setError(extractErrorMessage(err, 'Failed to delete boundary.'))
      }
    } finally {
      setSaving(false)
    }
  }

  const warnings = boundaryWarnings(analysis)
  const shapeChanged = !sameShape(draft, boundary)
  // Unsaved work exists once the editor has loaded and the shape differs from what is saved.
  const dirty = open && !loading && shapeChanged

  // Autosave the in-progress shape to this browser (debounced; flushed at once when the
  // tab is hidden, the one reliable "user is leaving" signal). Paused while an older
  // draft is waiting on Resume/Discard so it cannot be overwritten unseen.
  useEffect(() => {
    if (!dirty || resumable || !draft) return
    const write = () => setPersistFailed(!saveDraft(city.id, updatedAt, draft))
    const timer = setTimeout(write, DRAFT_DEBOUNCE_MS)
    const onHide = () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); write() } }
    document.addEventListener('visibilitychange', onHide)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onHide) }
  }, [dirty, resumable, draft, city.id, updatedAt])

  // Native "leave this page?" prompt, installed only while there is something to lose.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const handleOpenChange = (next: boolean) => {
    if (!next && dirty) { setCloseConfirm(true); return }
    if (!next) { setResumable(null); setPersistFailed(false) }
    setOpen(next)
  }
  const finishClose = () => { setCloseConfirm(false); setResumable(null); setPersistFailed(false); setOpen(false) }
  const closeKeepingDraft = () => {
    // Flush now: the debounced write may not have fired yet.
    if (draft && saveDraft(city.id, updatedAt, draft)) finishClose()
    else setPersistFailed(true)
  }
  const closeDiscarding = () => { clearDraft(city.id); finishClose() }

  const resumeDraft = () => {
    if (!resumable) return
    const err = loadFeatureRef.current ? loadFeatureRef.current(resumable.polygon) : 'the map is still loading, try again in a moment'
    if (err) { setError(`Could not resume the draft: ${err}`); return }
    setError('')
    setResumable(null)
  }
  const discardDraft = () => { clearDraft(city.id); setResumable(null) }
  // Invalid shapes are blocked here (server also re-validates on Save).
  const canSave = !!draft && !saving && !previewing && !previewError && analysis?.isValid !== false

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Edit boundary" aria-label={`Edit boundary for ${city.name}`}>
          <MapPin size={14} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-4 md:inset-8 z-[70] bg-surface rounded-2xl shadow-hover flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-light flex-shrink-0">
            <div>
              <Dialog.Title className="text-lg font-bold text-text-primary">Edit boundary: {city.name}</Dialog.Title>
              <Dialog.Description className="text-xs text-text-muted mt-0.5">
                Drag the shape or its points to reshape it. Changes route riders as soon as you save.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-2 rounded-lg transition-colors" aria-label="Close">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <div className="flex-1 flex flex-col md:flex-row min-h-0">
              {/* Map — primary, ~70% width */}
              <div className="relative flex-1 md:basis-[70%] min-h-[300px]">
                <GoogleMap
                  defaultCenter={{ lat: city.centroid_lat, lng: city.centroid_lng }}
                  defaultZoom={11}
                  mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
                  gestureHandling="greedy"
                  disableDefaultUI
                  style={{ width: '100%', height: '100%' }}
                >
                  <BoundaryMapLayer key={`${city.id}:${updatedAt}`} cityId={city.id} initialBoundary={boundary} overlays={overlays} onChange={handleDrawChange} onError={setError} loadFeatureRef={loadFeatureRef} />
                </GoogleMap>
              </div>

              {/* Status strip + controls — ~30% width */}
              <div className="md:basis-[30%] md:max-w-sm border-t md:border-t-0 md:border-l border-border-light p-4 space-y-3 overflow-y-auto">
                {resumable && (
                  <div className="admin-card !p-4 !bg-warning-light space-y-2">
                    <p className="text-sm font-semibold text-warning">Unsaved draft from {timeAgo(resumable.savedAt)}</p>
                    {resumable.stale && (
                      <p className="text-xs text-text-secondary">This boundary has changed since you started the draft. Resuming keeps your shape; saving replaces the current one.</p>
                    )}
                    <div className="flex gap-2">
                      <button onClick={resumeDraft} className="btn-secondary flex-1 justify-center !text-xs">Resume draft</button>
                      <button onClick={discardDraft} className="btn-secondary flex-1 justify-center !text-xs">Discard draft</button>
                    </div>
                  </div>
                )}

                {conflict && (
                  <div role="alert" className="admin-card !p-4 !bg-warning-light space-y-2">
                    <p className="text-sm font-semibold text-warning">Someone else saved a newer boundary</p>
                    <div className="flex gap-2">
                      <button onClick={() => void doSave(conflict.updatedAt)} disabled={saving} className="btn-secondary flex-1 justify-center !text-xs">Overwrite with mine</button>
                      <button onClick={() => { clearDraft(city.id); setUpdatedAt(conflict.updatedAt); void load() }} disabled={saving} className="btn-secondary flex-1 justify-center !text-xs">Discard mine, reload theirs</button>
                    </div>
                  </div>
                )}

                {savedBanner && (
                  <div role="status" className="admin-card !p-4 !bg-success-light flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-success">Saved — riders in this area may be affected immediately</p>
                    <button onClick={() => void handleUndo()} disabled={saving} className="btn-secondary !text-xs flex-shrink-0"><Undo2 size={13} />Undo</button>
                  </div>
                )}

                <StatusStrip hasShape={!!draft} analysis={analysis} previewing={previewing} />

                {/* Secondary — not co-equal with drawing (decision 1). */}
                {!pasteOpen ? (
                  <button onClick={() => setPasteOpen(true)} className="text-xs font-semibold text-primary hover:underline">
                    Paste GeoJSON instead
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    <textarea
                      aria-label="GeoJSON polygon"
                      value={pasteText} onChange={e => setPasteText(e.target.value)}
                      placeholder='{ "type": "Polygon", "coordinates": [...] }'
                      rows={4}
                      className="w-full border border-border rounded-xl px-3 py-2 text-xs font-mono text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
                    />
                    {pasteError && <p role="alert" className="text-xs text-danger">{pasteError}</p>}
                    <div className="flex gap-2">
                      <button onClick={handlePasteLoad} disabled={!pasteText.trim()} className="btn-secondary !text-xs !py-1.5 disabled:opacity-50">Load</button>
                      <button onClick={() => { setPasteOpen(false); setPasteText(''); setPasteError('') }} className="text-xs text-text-muted hover:text-text-secondary">Cancel</button>
                    </div>
                  </div>
                )}

                {previewError && <p role="alert" className="text-xs text-danger font-semibold">{previewError}</p>}

                {error && <p role="alert" className="text-xs text-danger font-semibold">{error}</p>}

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    onClick={() => {
                      if (warnings.length > 0 && !confirmWarnings) { setConfirmWarnings(true); return }
                      setConfirmWarnings(false)
                      void doSave(updatedAt)
                    }}
                    disabled={!canSave || !shapeChanged}
                    className="btn-primary justify-center disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {saving
                      ? 'Saving…'
                      : confirmWarnings
                        ? `Save anyway — ${warnings.length} warning${warnings.length > 1 ? 's' : ''} acknowledged`
                        : 'Save boundary'}
                  </button>
                  <p className="text-xs text-text-muted text-center -mt-0.5">Riders in this area are routed as in-city immediately.</p>
                  {boundary && (
                    <button
                      onClick={() => setDeleteOpen(true)}
                      disabled={saving}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-danger-light text-danger text-sm font-semibold hover:bg-danger hover:text-white transition-all duration-150 disabled:opacity-50"
                    >
                      <Trash2 size={15} />Delete boundary
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>

      {/* Closing with unsaved work: autosave makes this recoverable, so say so honestly */}
      <Dialog.Root open={closeConfirm} onOpenChange={setCloseConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-text-primary/40 backdrop-blur-sm" />
          <Dialog.Content role="alertdialog" className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] bg-surface rounded-2xl shadow-hover p-6 z-[80]">
            <Dialog.Title className="text-lg font-bold text-text-primary mb-2">Close with unsaved changes?</Dialog.Title>
            <Dialog.Description className="text-sm text-text-secondary mb-4">
              {persistFailed
                ? 'You have unsaved changes to this boundary. This browser could not store a draft, so they will be lost if you close.'
                : 'You have unsaved changes to this boundary. A draft is kept in this browser, and you can resume it next time you open this city.'}
            </Dialog.Description>
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={() => setCloseConfirm(false)} className="btn-secondary">Keep editing</button>
              {!persistFailed && <button onClick={closeKeepingDraft} className="btn-secondary">Close, keep draft</button>}
              <button onClick={closeDiscarding} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-danger text-white text-sm font-semibold hover:bg-red-600 transition-colors">Discard changes</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Delete confirm — typed confirmation, matches drivers/[id]/page.tsx's precedent */}
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-text-primary/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] bg-surface rounded-2xl shadow-hover p-6 z-[80]">
            <Dialog.Title className="text-lg font-bold text-text-primary mb-2">Delete boundary</Dialog.Title>
            <Dialog.Description className="text-sm text-text-secondary mb-4">
              This drops <strong>{city.name}</strong> back to never classifying as in-city for any trip. Riders are affected immediately.
            </Dialog.Description>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Type the city name (<span className="font-mono">{city.name}</span>) to confirm
            </label>
            <input
              value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={city.name}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm font-mono text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-danger/30 placeholder:text-text-muted mb-1"
            />
            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => { setDeleteOpen(false); setDeleteConfirmText('') }} disabled={saving} className="btn-secondary">Cancel</button>
              <button
                onClick={() => void handleDelete()}
                disabled={saving || deleteConfirmText.trim() !== city.name}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-danger text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Deleting…' : 'Delete boundary'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  )
}
