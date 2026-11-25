// Moves map markers smoothly between location fixes without going through React.
//
// The old way kept each driver's displayed position in React state and updated it on every animation frame: with hundreds of drivers in a
// glide at once, that was hundreds of renders per frame. Here ONE animation loop moves all the markers by setting `marker.position` directly,
// and it stops by itself when nothing is moving.

export interface LatLng { lat: number; lng: number }
export interface Positionable { position?: unknown }

export const GLIDE_MS = 2_500

export function lerp(from: LatLng, to: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t))
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k }
}

interface Item { marker: Positionable; from: LatLng; to: LatLng; start: number; current: LatLng }

export interface GliderDeps {
  now: () => number
  raf: (cb: () => void) => number
  cancel: (id: number) => void
}

export function createGlider(durationMs = GLIDE_MS, deps?: Partial<GliderDeps>) {
  const d: GliderDeps = {
    now: deps?.now ?? (() => performance.now()),
    raf: deps?.raf ?? ((cb) => requestAnimationFrame(cb)),
    cancel: deps?.cancel ?? ((id) => cancelAnimationFrame(id)),
  }
  const items = new Map<string, Item>()
  let handle: number | null = null

  function tick(): void {
    handle = null
    const t = d.now()
    let moving = false
    for (const it of items.values()) {
      const k = (t - it.start) / durationMs
      if (k >= 1) {
        if (it.current !== it.to) { it.current = it.to; it.marker.position = it.to }
        continue
      }
      it.current = lerp(it.from, it.to, k)
      it.marker.position = it.current
      moving = true
    }
    if (moving) handle = d.raf(tick)
  }

  return {
    /** Glide this marker to a new fix. The first fix, or a marker the map has replaced, is placed straight away. */
    moveTo(id: string, marker: Positionable, lat: number, lng: number): void {
      const to = { lat, lng }
      const it = items.get(id)
      if (!it || it.marker !== marker) {
        marker.position = to
        items.set(id, { marker, from: to, to, start: d.now(), current: to })
        return
      }
      if (it.to.lat === lat && it.to.lng === lng) return
      // Start from wherever the dot is right now, so a new fix mid-glide never makes it jump.
      it.from = it.current
      it.to = to
      it.start = d.now()
      if (handle === null) handle = d.raf(tick)
    },
    remove(id: string): void { items.delete(id) },
    /** Stop the loop (the map is going away). */
    dispose(): void { if (handle !== null) d.cancel(handle); handle = null; items.clear() },
    /** For tests and diagnostics. */
    get size(): number { return items.size },
    get running(): boolean { return handle !== null },
  }
}

// One glider for the live map: markers register with it by driver id.
export const driverGlider = createGlider()
