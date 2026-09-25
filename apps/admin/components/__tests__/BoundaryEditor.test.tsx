// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosResponse } from 'axios'
import type { CityBoundaryAnalysis, CityBoundaryGeoJson } from '@/lib/boundary-api'
import type { AdminCity } from '@/lib/city-api'

// ── Mocks: map + drawing libs (no real Google Maps in jsdom) ─────────────────

interface FakeDraw {
  handlers: Record<string, () => void>
  snapshot: Array<{ id: number; geometry: { coordinates: unknown } }>
}
const td = vi.hoisted(() => ({ instances: [] as FakeDraw[], rejectFeatures: false }))

vi.mock('terra-draw', () => {
  class TerraDraw {
    handlers: Record<string, () => void> = {}
    snapshot: FakeDraw['snapshot'] = []
    constructor() { td.instances.push(this) }
    start() { queueMicrotask(() => this.handlers.ready?.()) } // real adapter: async 'ready'
    stop() {}
    setMode() {}
    selectFeature() {}
    clear() { this.snapshot = [] }
    // Mirrors real Terra Draw: a feature without properties.mode (or one the test
    // marks unloadable) is rejected with { valid: false } and NOT added.
    addFeatures(features: Array<{ properties?: { mode?: string }; geometry: { coordinates: unknown } }>) {
      const results = features.map(f =>
        td.rejectFeatures ? { valid: false, reason: 'Feature is not valid' }
        : f.properties?.mode !== 'polygon' ? { valid: false, reason: 'Feature does not have a mode property' }
        : { valid: true })
      if (results.every(r => r.valid)) this.snapshot = features.map((f, i) => ({ id: i + 1, geometry: f.geometry }))
      return results
    }
    getSnapshot() { return this.snapshot }
    on(event: string, cb: () => void) { this.handlers[event] = cb }
  }
  return { TerraDraw, TerraDrawPolygonMode: class {}, TerraDrawSelectMode: class {} }
})
vi.mock('terra-draw-google-maps-adapter', () => ({ TerraDrawGoogleMapsAdapter: class {} }))
// useMap must return a *stable* object like the real hook — a fresh one per render
// would re-run the layer's init effect (new TerraDraw, empty store) every render.
// A real DOM node stands in for the map div. Google renders the inner `.gm-style`
// element a beat AFTER the Map instance exists — the real-browser crash this guards.
const mapDom = vi.hoisted(() => ({ div: null as HTMLElement | null, projection: true, listeners: [] as Array<{ evt: string; cb: () => void; removed: boolean }> }))
const fakeMap = vi.hoisted(() => ({
  getDiv: () => mapDom.div!,
  getProjection: () => (mapDom.projection ? {} : undefined),
  addListener: (evt: string, cb: () => void) => {
    const l = { evt, cb, removed: false }
    mapDom.listeners.push(l)
    return { remove: () => { l.removed = true } }
  },
}))
vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  useMap: () => fakeMap,
}))

const infoWindows = vi.hoisted(() => [] as Array<{ content: unknown }>)
const polygons = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.stubGlobal('google', {
  maps: {
    Polygon: class {
      constructor(opts: Record<string, unknown>) { polygons.push(opts) }
      setMap() {}
      addListener() {}
    },
    InfoWindow: class {
      constructor(opts: { content: unknown }) { infoWindows.push(opts) }
      setPosition() {}
      open() {}
      close() {}
    },
  },
})

// ── Mocks: API clients ───────────────────────────────────────────────────────

const boundaryApi = vi.hoisted(() => ({ get: vi.fn(), preview: vi.fn(), save: vi.fn(), remove: vi.fn() }))
const cityApi = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/boundary-api', () => ({ boundaryApi }))
vi.mock('@/lib/city-api', () => ({ cityApi }))

import BoundaryEditor from '../BoundaryEditor'
import { saveDraft, loadDraft, draftKey } from '@/lib/boundary-draft'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CITY: AdminCity = {
  id: 3, name: 'Puri', slug: 'puri', state: 'Odisha', centroid_lat: 19.81, centroid_lng: 85.83,
  default_speed_limit_kmph: 50, status: 'active', is_rental_enabled: true, is_return_cab_enabled: false,
  billing_mode: 'commission', created_at: '2026-01-01T00:00:00Z',
}
const OWN: CityBoundaryGeoJson = { type: 'Polygon', coordinates: [[[85.8, 19.8], [85.9, 19.8], [85.9, 19.9], [85.8, 19.8]]] }
const EDITED: [number, number][] = [[85.8, 19.8], [85.95, 19.8], [85.95, 19.95], [85.8, 19.8]]

const analysis = (over: Partial<CityBoundaryAnalysis> = {}): CityBoundaryAnalysis => ({
  isValid: true, invalidReason: null, vertexCount: 4, areaKm2: 42.5, bboxKm: { widthKm: 10, heightKm: 10 },
  centroidInside: true, overlaps: [], ...over,
})

function conflictError(): AxiosError {
  return new AxiosError('conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409, statusText: '', headers: {}, config: {}, data: { error: 'Someone else saved', code: 'BOUNDARY_CHANGED' },
  } as unknown as AxiosResponse)
}

function setup(own: CityBoundaryGeoJson | null, others: Array<{ id: number; name: string; boundary: CityBoundaryGeoJson | null }> = []) {
  boundaryApi.get.mockImplementation(async (id: number) => {
    if (id === CITY.id) return { name: CITY.name, boundary: own, updatedAt: 'v1' }
    const o = others.find(x => x.id === id)!
    return { name: o.name, boundary: o.boundary, updatedAt: 'x' }
  })
  cityApi.list.mockResolvedValue([CITY, ...others.map(o => ({ ...CITY, id: o.id, name: o.name }))])
  boundaryApi.preview.mockResolvedValue(analysis())
}

async function openEditor() {
  const user = userEvent.setup()
  render(<BoundaryEditor city={CITY} />)
  await user.click(screen.getByRole('button', { name: 'Edit boundary for Puri' }))
  await screen.findByText('Edit boundary: Puri')
  await waitFor(() => expect(td.instances.length).toBeGreaterThan(0))
  return user
}

/** Simulate the admin (re)drawing the polygon on the map. */
async function drawShape(coords: [number, number][]) {
  const draw = td.instances.at(-1)!
  draw.snapshot = [{ id: 1, geometry: { coordinates: [coords] } }]
  await act(async () => { draw.handlers['change']!() })
}

const saveButton = () => screen.getByRole('button', { name: /^Save/ })

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  td.instances.length = 0
  td.rejectFeatures = false
  infoWindows.length = 0
  polygons.length = 0
  mapDom.projection = true
  mapDom.listeners.length = 0
  mapDom.div = document.createElement('div')
  mapDom.div.append(Object.assign(document.createElement('div'), { className: 'gm-style' }))
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BoundaryEditor', () => {
  describe('loading and empty state', () => {
    it('shows the empty state, no Delete, and a disabled Save for a city with no boundary', async () => {
      setup(null)
      await openEditor()
      expect(screen.getByText('No boundary yet')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /delete boundary/i })).not.toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })

    it('loads an existing boundary into the draw layer and offers Delete; Save stays disabled until changed', async () => {
      setup(OWN)
      await openEditor()
      expect(td.instances.at(-1)!.snapshot).toHaveLength(1)
      expect(screen.getByRole('button', { name: /delete boundary/i })).toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })

    it('shows an error when the boundary cannot be loaded', async () => {
      boundaryApi.get.mockRejectedValue(new Error('down'))
      cityApi.list.mockResolvedValue([CITY])
      const user = userEvent.setup()
      render(<BoundaryEditor city={CITY} />)
      await user.click(screen.getByRole('button', { name: 'Edit boundary for Puri' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load boundary.')
    })
  })

  describe('map readiness', () => {
    const renderClosed = async () => {
      mapDom.div!.replaceChildren() // map instance exists, inner DOM not rendered yet
      setup(OWN)
      const user = userEvent.setup()
      render(<BoundaryEditor city={CITY} />)
      await user.click(screen.getByRole('button', { name: 'Edit boundary for Puri' }))
      await screen.findByText('Edit boundary: Puri')
      return user
    }
    const renderMapDom = async () => {
      await act(async () => { mapDom.div!.append(Object.assign(document.createElement('div'), { className: 'gm-style' })) })
    }

    it('waits for the map DOM before starting Terra Draw (no crash on a not-yet-rendered map)', async () => {
      await renderClosed()
      await new Promise(r => setTimeout(r, 50))
      expect(td.instances).toHaveLength(0) // not created yet
      await renderMapDom()
      await waitFor(() => expect(td.instances).toHaveLength(1))
      expect(td.instances[0]!.snapshot).toHaveLength(1) // existing boundary loaded once ready
    })

    it('also waits for the map projection ("cannot get projection" in a real browser)', async () => {
      mapDom.projection = false
      setup(OWN)
      const user = userEvent.setup()
      render(<BoundaryEditor city={CITY} />)
      await user.click(screen.getByRole('button', { name: 'Edit boundary for Puri' }))
      await screen.findByText('Edit boundary: Puri')
      await waitFor(() => expect(mapDom.listeners.some(l => l.evt === 'projection_changed')).toBe(true))
      expect(td.instances).toHaveLength(0) // DOM is there, projection is not: still waiting
      await act(async () => { mapDom.projection = true; mapDom.listeners.find(l => l.evt === 'projection_changed')!.cb() })
      expect(td.instances).toHaveLength(1)
      expect(mapDom.listeners.every(l => l.removed)).toBe(true) // stopped waiting once started
    })

    it('does not start Terra Draw if the dialog closes before the map ever renders', async () => {
      const user = await renderClosed()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByText('Edit boundary: Puri')).not.toBeInTheDocument())
      await renderMapDom() // a late render must be a no-op
      await new Promise(r => setTimeout(r, 50))
      expect(td.instances).toHaveLength(0)
    })
  })

  describe('existing boundary and paste loading', () => {
    it('runs the live check on the existing shape as soon as the editor opens', async () => {
      setup(OWN)
      await openEditor()
      await waitFor(() => expect(boundaryApi.preview).toHaveBeenCalledWith(CITY.id, expect.objectContaining({ type: 'Polygon' })))
      expect(await screen.findByText('Valid')).toBeInTheDocument()
      expect(saveButton()).toBeDisabled() // unchanged shape: nothing to save
    })

    it('tells the admin when Terra Draw rejects the existing boundary instead of showing a blank map', async () => {
      setup(OWN)
      td.rejectFeatures = true
      await openEditor()
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the existing boundary')
    })

    it('shows the load error in the paste box when Terra Draw rejects a pasted polygon', async () => {
      setup(null)
      const user = await openEditor()
      td.rejectFeatures = true
      await user.click(screen.getByRole('button', { name: 'Paste GeoJSON instead' }))
      await user.click(screen.getByLabelText('GeoJSON polygon'))
      await user.paste(JSON.stringify(OWN))
      await user.click(screen.getByRole('button', { name: 'Load' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Feature is not valid')
      expect(screen.getByLabelText('GeoJSON polygon')).toBeInTheDocument() // stays open for a fix
    })
  })

  describe('live preview and save gating', () => {
    it('previews (debounced) after a draw change and shows vertices, area and a Valid pill', async () => {
      setup(OWN)
      await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(boundaryApi.preview).toHaveBeenCalledWith(CITY.id, expect.objectContaining({ type: 'Polygon' })))
      expect(await screen.findByText('Valid')).toBeInTheDocument()
      expect(screen.getByText('42.5 km²')).toBeInTheDocument()
      expect(saveButton()).toBeEnabled()
    })

    it('blocks Save and shows the reason for an invalid shape', async () => {
      setup(OWN)
      boundaryApi.preview.mockResolvedValue(analysis({ isValid: false, invalidReason: 'Self-intersection at or near point 1 2' }))
      await openEditor()
      await drawShape(EDITED)
      expect(await screen.findByText('Invalid')).toBeInTheDocument()
      expect(screen.getByText(/Self-intersection/)).toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })

    it('tells the admin why a preview failed and keeps Save disabled (e.g. shape outside the service region)', async () => {
      setup(OWN)
      boundaryApi.preview.mockRejectedValue(new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 422, statusText: '', headers: {}, config: {}, data: { error: 'Coordinates must fall within the service region' },
      } as unknown as AxiosResponse))
      await openEditor()
      await drawShape(EDITED)
      expect(await screen.findByRole('alert')).toHaveTextContent('Coordinates must fall within the service region')
      expect(saveButton()).toBeDisabled()
    })

    it('ignores a slow preview response that a newer edit has superseded', async () => {
      setup(OWN)
      let resolveFirst!: (a: CityBoundaryAnalysis) => void
      boundaryApi.preview
        .mockImplementationOnce(() => new Promise<CityBoundaryAnalysis>(r => { resolveFirst = r }))
        .mockResolvedValueOnce(analysis({ areaKm2: 222 }))
      await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(boundaryApi.preview).toHaveBeenCalledTimes(1))
      await drawShape([[85.8, 19.8], [86.0, 19.8], [86.0, 20.0], [85.8, 19.8]])
      expect(await screen.findByText('222.0 km²')).toBeInTheDocument()
      await act(async () => { resolveFirst(analysis({ areaKm2: 1 })) })
      expect(screen.getByText('222.0 km²')).toBeInTheDocument()
      expect(screen.queryByText('1.0 km²')).not.toBeInTheDocument()
    })
  })

  describe('saving', () => {
    it('saves with the loaded version, then shows the stakes banner', async () => {
      setup(OWN)
      boundaryApi.save.mockResolvedValue({ boundary: OWN, previousBoundary: OWN, updatedAt: 'v2' })
      const user = await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(saveButton()).toBeEnabled())
      await user.click(saveButton())
      expect(boundaryApi.save).toHaveBeenCalledWith(CITY.id, { type: 'Polygon', coordinates: [EDITED] }, 'v1')
      expect(await screen.findByText(/Saved — riders in this area may be affected immediately/)).toBeInTheDocument()
    })

    it('makes the admin acknowledge overlap / centroid warnings before saving (two-step)', async () => {
      setup(OWN)
      boundaryApi.preview.mockResolvedValue(analysis({ overlaps: [{ cityId: 1, name: 'Cuttack', pctOfNew: 100 }] }))
      boundaryApi.save.mockResolvedValue({ boundary: OWN, previousBoundary: OWN, updatedAt: 'v2' })
      const user = await openEditor()
      await drawShape(EDITED)
      await screen.findByText('Valid')
      await user.click(saveButton())
      expect(boundaryApi.save).not.toHaveBeenCalled()
      expect(saveButton()).toHaveTextContent('Save anyway — 1 warning acknowledged')
      await user.click(saveButton())
      expect(boundaryApi.save).toHaveBeenCalledTimes(1)
    })

    it('re-requires acknowledgement after the shape changes again', async () => {
      setup(OWN)
      boundaryApi.preview.mockResolvedValue(analysis({ centroidInside: false }))
      const user = await openEditor()
      await drawShape(EDITED)
      await screen.findByText('Valid')
      await user.click(saveButton())
      expect(saveButton()).toHaveTextContent('Save anyway')
      await drawShape([[85.8, 19.8], [86.0, 19.8], [86.0, 20.0], [85.8, 19.8]])
      expect(saveButton()).not.toHaveTextContent('Save anyway')
    })

    it('surfaces the server message when Save is rejected (422)', async () => {
      setup(OWN)
      boundaryApi.save.mockRejectedValue(new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 422, statusText: '', headers: {}, config: {}, data: { error: 'Boundary area (0.0 km²) must be between 0.5 and 5000 km²' },
      } as unknown as AxiosResponse))
      const user = await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(saveButton()).toBeEnabled())
      await user.click(saveButton())
      expect(await screen.findByRole('alert')).toHaveTextContent('Boundary area')
    })
  })

  describe('409 conflict recovery', () => {
    it('keeps the drawn shape and lets the admin overwrite with the fresh version', async () => {
      setup(OWN)
      boundaryApi.save
        .mockRejectedValueOnce(conflictError())
        .mockResolvedValueOnce({ boundary: OWN, previousBoundary: OWN, updatedAt: 'v10' })
      boundaryApi.get.mockImplementation(async () => ({ name: CITY.name, boundary: OWN, updatedAt: 'v9' }))
      const user = await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(saveButton()).toBeEnabled())
      await user.click(saveButton())

      const banner = await screen.findByText('Someone else saved a newer boundary')
      expect(banner).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Overwrite with mine' }))
      expect(boundaryApi.save).toHaveBeenLastCalledWith(CITY.id, { type: 'Polygon', coordinates: [EDITED] }, 'v9')
    })
  })

  describe('409 conflict when the refetch also fails', () => {
    it('shows an error instead of throwing an unhandled rejection', async () => {
      setup(OWN)
      boundaryApi.save.mockRejectedValue(conflictError())
      const user = await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(saveButton()).toBeEnabled())
      boundaryApi.get.mockRejectedValue(new Error('down'))
      await user.click(saveButton())
      expect(await screen.findByRole('alert')).toHaveTextContent(/latest version could not be loaded/)
      expect(screen.queryByText('Someone else saved a newer boundary')).not.toBeInTheDocument()
    })
  })

  describe('undo', () => {
    it('restores the previous boundary after a save', async () => {
      setup(OWN)
      const previous: CityBoundaryGeoJson = { type: 'Polygon', coordinates: [[[85.7, 19.7], [85.8, 19.7], [85.8, 19.8], [85.7, 19.7]]] }
      boundaryApi.save
        .mockResolvedValueOnce({ boundary: OWN, previousBoundary: previous, updatedAt: 'v2' })
        .mockResolvedValueOnce({ boundary: previous, previousBoundary: OWN, updatedAt: 'v3' })
      const user = await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(saveButton()).toBeEnabled())
      await user.click(saveButton())
      await user.click(await screen.findByRole('button', { name: /undo/i }))
      expect(boundaryApi.save).toHaveBeenLastCalledWith(CITY.id, previous, 'v2')
      await waitFor(() => expect(screen.queryByText(/Saved — riders/)).not.toBeInTheDocument())
    })

    it('removes the boundary when undoing the very first save', async () => {
      setup(null)
      boundaryApi.save.mockResolvedValue({ boundary: OWN, previousBoundary: null, updatedAt: 'v2' })
      boundaryApi.remove.mockResolvedValue({ previousBoundary: OWN, updatedAt: 'v3' })
      const user = await openEditor()
      await drawShape(EDITED)
      await waitFor(() => expect(saveButton()).toBeEnabled())
      await user.click(saveButton())
      await user.click(await screen.findByRole('button', { name: /undo/i }))
      expect(boundaryApi.remove).toHaveBeenCalledWith(CITY.id, 'v2')
    })
  })

  describe('delete', () => {
    it('requires typing the exact city name before the destructive button enables', async () => {
      setup(OWN)
      boundaryApi.remove.mockResolvedValue({ previousBoundary: OWN, updatedAt: 'v2' })
      const user = await openEditor()
      await user.click(screen.getByRole('button', { name: /^Delete boundary$/ }))

      const dialog = await screen.findByRole('dialog', { name: 'Delete boundary' })
      const confirm = within(dialog).getByRole('button', { name: 'Delete boundary' })
      expect(confirm).toBeDisabled()
      const input = within(dialog).getByRole('textbox')
      await user.type(input, 'puri')
      expect(confirm).toBeDisabled() // case-sensitive
      await user.clear(input)
      await user.type(input, 'Puri')
      expect(confirm).toBeEnabled()
      await user.click(confirm)
      expect(boundaryApi.remove).toHaveBeenCalledWith(CITY.id, 'v1')
      expect(await screen.findByText(/Saved — riders in this area may be affected immediately/)).toBeInTheDocument()
    })
  })

  describe('paste GeoJSON', () => {
    it('rejects malformed input with a specific message and does not touch the map', async () => {
      setup(null)
      const user = await openEditor()
      await user.click(screen.getByRole('button', { name: 'Paste GeoJSON instead' }))
      await user.type(screen.getByLabelText('GeoJSON polygon'), 'not json')
      await user.click(screen.getByRole('button', { name: 'Load' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Not valid JSON.')
      expect(td.instances.at(-1)!.snapshot).toHaveLength(0)
    })

    it('loads a valid polygon into the draw layer and triggers a preview', async () => {
      setup(null)
      const user = await openEditor()
      await user.click(screen.getByRole('button', { name: 'Paste GeoJSON instead' }))
      // userEvent treats { and [ as key descriptors — paste the text instead.
      await user.click(screen.getByLabelText('GeoJSON polygon'))
      await user.paste(JSON.stringify(OWN))
      await user.click(screen.getByRole('button', { name: 'Load' }))
      expect(td.instances.at(-1)!.snapshot).toHaveLength(1)
      await waitFor(() => expect(boundaryApi.preview).toHaveBeenCalled())
    })
  })

  describe('overlays of other cities', () => {
    it('renders hover labels as plain text nodes, never HTML (stored-XSS guard)', async () => {
      const evil = '<img src=x onerror=alert(1)>'
      setup(OWN, [{ id: 9, name: evil, boundary: OWN }])
      await openEditor()
      await waitFor(() => expect(infoWindows.length).toBeGreaterThan(0))
      const content = infoWindows[0]!.content
      expect(content).toBeInstanceOf(HTMLElement)
      const el = content as HTMLElement
      expect(el.textContent).toBe(evil)
      expect(el.querySelector('img')).toBeNull()
    })

    it('keeps overlays clickable (Google fires no hover events otherwise) but unfilled', async () => {
      setup(OWN, [{ id: 9, name: 'Cuttack', boundary: OWN }])
      await openEditor()
      await waitFor(() => expect(polygons.length).toBeGreaterThan(0))
      expect(polygons[0]).toMatchObject({ clickable: true, fillOpacity: 0, strokeColor: '#94A3B8' })
    })

    it('skips other cities that have no boundary', async () => {
      setup(OWN, [{ id: 9, name: 'Angul', boundary: null }])
      await openEditor()
      expect(infoWindows).toHaveLength(0)
    })
  })

  describe('unsaved-work protection', () => {
    const EDITED_POLY: CityBoundaryGeoJson = { type: 'Polygon', coordinates: [EDITED] }
    const closeAttempt = async (user: ReturnType<typeof userEvent.setup>) => { await user.keyboard('{Escape}') }
    const confirmDialog = () => screen.queryByRole('alertdialog')

    describe('local draft autosave', () => {
      it('saves an edited shape as a draft with the version it was based on', async () => {
        setup(OWN)
        await openEditor()
        await drawShape(EDITED)
        await waitFor(() => expect(loadDraft(CITY.id)?.polygon).toEqual(EDITED_POLY))
        expect(loadDraft(CITY.id)?.baseUpdatedAt).toBe('v1')
      })

      it('writes nothing for an untouched shape', async () => {
        setup(OWN)
        await openEditor()
        await new Promise(r => setTimeout(r, 700))
        expect(localStorage.getItem(draftKey(CITY.id))).toBeNull()
      })

      it('clears the draft once the shape is saved', async () => {
        setup(OWN)
        boundaryApi.save.mockResolvedValue({ boundary: EDITED_POLY, previousBoundary: OWN, updatedAt: 'v2' })
        const user = await openEditor()
        await drawShape(EDITED)
        await waitFor(() => expect(loadDraft(CITY.id)).not.toBeNull())
        await waitFor(() => expect(saveButton()).toBeEnabled())
        await user.click(saveButton())
        await screen.findByText(/Saved — riders/)
        expect(loadDraft(CITY.id)).toBeNull()
      })
    })

    describe('resuming a draft', () => {
      it('offers to resume a draft on open, and Resume loads it as an editable, unsaved change', async () => {
        setup(OWN)
        saveDraft(CITY.id, 'v1', EDITED_POLY)
        const user = await openEditor()
        expect(await screen.findByText(/Unsaved draft/)).toBeInTheDocument()
        expect(screen.queryByText(/changed since/i)).not.toBeInTheDocument() // same version: no stale warning
        await user.click(screen.getByRole('button', { name: 'Resume draft' }))
        expect(td.instances.at(-1)!.snapshot[0]!.geometry.coordinates).toEqual([EDITED])
        await waitFor(() => expect(saveButton()).toBeEnabled())
        expect(screen.queryByText(/Unsaved draft/)).not.toBeInTheDocument()
      })

      it('warns when the boundary changed since the draft was started, and still lets the admin choose', async () => {
        setup(OWN)
        saveDraft(CITY.id, 'an-older-version', EDITED_POLY)
        const user = await openEditor()
        expect(await screen.findByText(/changed since/i)).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Resume draft' }))
        await waitFor(() => expect(saveButton()).toBeEnabled())
        // Saving still goes against the CURRENT server version, so nothing is overwritten unseen.
        boundaryApi.save.mockResolvedValue({ boundary: EDITED_POLY, previousBoundary: OWN, updatedAt: 'v2' })
        await user.click(saveButton())
        expect(boundaryApi.save).toHaveBeenCalledWith(CITY.id, EDITED_POLY, 'v1')
      })

      it('Discard removes the draft and the banner', async () => {
        setup(OWN)
        saveDraft(CITY.id, 'v1', EDITED_POLY)
        const user = await openEditor()
        await user.click(await screen.findByRole('button', { name: 'Discard draft' }))
        expect(screen.queryByText(/Unsaved draft/)).not.toBeInTheDocument()
        expect(loadDraft(CITY.id)).toBeNull()
      })

      it('silently drops a draft identical to the saved boundary', async () => {
        setup(OWN)
        saveDraft(CITY.id, 'v1', OWN)
        await openEditor()
        await waitFor(() => expect(loadDraft(CITY.id)).toBeNull())
        expect(screen.queryByText(/Unsaved draft/)).not.toBeInTheDocument()
      })
    })

    describe('closing with unsaved changes', () => {
      it('closes straight away when nothing changed', async () => {
        setup(OWN)
        const user = await openEditor()
        await closeAttempt(user)
        await waitFor(() => expect(screen.queryByText('Edit boundary: Puri')).not.toBeInTheDocument())
        expect(confirmDialog()).not.toBeInTheDocument()
      })

      it('asks first when there are unsaved changes, and Keep editing stays put', async () => {
        setup(OWN)
        const user = await openEditor()
        await drawShape(EDITED)
        await closeAttempt(user)
        expect(await screen.findByRole('alertdialog')).toHaveTextContent('unsaved')
        await user.click(screen.getByRole('button', { name: 'Keep editing' }))
        expect(confirmDialog()).not.toBeInTheDocument()
        expect(screen.getByText('Edit boundary: Puri')).toBeInTheDocument()
      })

      it('"Close, keep draft" closes and leaves the draft for next time', async () => {
        setup(OWN)
        const user = await openEditor()
        await drawShape(EDITED)
        await closeAttempt(user)
        await user.click(await screen.findByRole('button', { name: 'Close, keep draft' }))
        await waitFor(() => expect(screen.queryByText('Edit boundary: Puri')).not.toBeInTheDocument())
        expect(loadDraft(CITY.id)?.polygon).toEqual(EDITED_POLY)
      })

      it('"Discard changes" closes and removes the draft', async () => {
        setup(OWN)
        const user = await openEditor()
        await drawShape(EDITED)
        await closeAttempt(user)
        await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
        await waitFor(() => expect(screen.queryByText('Edit boundary: Puri')).not.toBeInTheDocument())
        expect(loadDraft(CITY.id)).toBeNull()
      })

      it('says the work will be lost (and offers no keep-draft) when the browser cannot store a draft', async () => {
        setup(OWN)
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
        const user = await openEditor()
        await drawShape(EDITED)
        await new Promise(r => setTimeout(r, 700)) // let the autosave attempt run and fail
        await closeAttempt(user)
        expect(await screen.findByRole('alertdialog')).toHaveTextContent(/will be lost/i)
        expect(screen.queryByRole('button', { name: 'Close, keep draft' })).not.toBeInTheDocument()
        vi.restoreAllMocks()
      })
    })

    describe('leaving the page', () => {
      const fireUnload = () => {
        const e = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(e)
        return e.defaultPrevented
      }

      it('warns on reload/tab close only while there are unsaved changes', async () => {
        setup(OWN)
        await openEditor()
        expect(fireUnload()).toBe(false) // clean: no listener, no nag
        await drawShape(EDITED)
        await waitFor(() => expect(fireUnload()).toBe(true))
      })

      it('removes the listener when the editor closes', async () => {
        setup(OWN)
        const user = await openEditor()
        await drawShape(EDITED)
        await waitFor(() => expect(fireUnload()).toBe(true))
        await closeAttempt(user)
        await user.click(await screen.findByRole('button', { name: 'Discard changes' }))
        await waitFor(() => expect(fireUnload()).toBe(false))
      })

      it('flushes the draft immediately when the tab is hidden', async () => {
        setup(OWN)
        await openEditor()
        await drawShape(EDITED)
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(loadDraft(CITY.id)?.polygon).toEqual(EDITED_POLY) // no debounce wait
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      })
    })
  })
})
