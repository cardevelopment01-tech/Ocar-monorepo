import type { Stage } from './live-map-model'

// Zoomed out, hundreds of driver dots become an unreadable pile (and hundreds of DOM markers the browser has to move). Below this zoom
// nearby drivers are merged into one numbered marker; at this zoom and closer every driver is drawn.
export const CLUSTER_BELOW_ZOOM = 14
// Drivers whose dots would fall inside the same square of this many screen pixels are merged.
export const CELL_PX = 64

export interface ClusterPoint {
  id: string
  lat: number
  lng: number
  stage: Stage
  /** Never merged: the selected driver, and an on-trip driver with no location (the case ops must not miss). */
  pinned: boolean
}

export interface Bounds { north: number; south: number; east: number; west: number }

export interface Cluster {
  key: string
  lat: number
  lng: number
  count: number
  ids: string[]
  /** The most urgent stage among its drivers: it colours the marker. */
  stage: Stage
  bounds: Bounds
}

export interface ClusterLayout { singles: string[]; clusters: Cluster[] }

// Waiting at a pickup is the one ops may need to act on soonest; a driver with no location is the least informative to colour a group by.
const URGENCY: Stage[] = ['waiting', 'to_pickup', 'on_trip', 'idle', 'no_location']
const worse = (a: Stage, b: Stage) => (URGENCY.indexOf(a) <= URGENCY.indexOf(b) ? a : b)

// Web Mercator: the point's position in pixels on the whole-world map at this zoom.
function worldPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180)
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale }
}

export function clusterPoints(points: ClusterPoint[], zoom: number): ClusterLayout {
  if (zoom >= CLUSTER_BELOW_ZOOM) return { singles: points.map((p) => p.id), clusters: [] }
  const singles: string[] = []
  const cells = new Map<string, ClusterPoint[]>()
  for (const p of points) {
    if (p.pinned) { singles.push(p.id); continue }
    const { x, y } = worldPx(p.lat, p.lng, zoom)
    const key = `${Math.floor(x / CELL_PX)}:${Math.floor(y / CELL_PX)}`
    const cell = cells.get(key)
    if (cell) cell.push(p); else cells.set(key, [p])
  }
  const clusters: Cluster[] = []
  for (const [key, members] of cells) {
    if (members.length === 1) { singles.push(members[0]!.id); continue }
    let lat = 0, lng = 0, stage = members[0]!.stage
    const bounds: Bounds = { north: -90, south: 90, east: -180, west: 180 }
    for (const m of members) {
      lat += m.lat; lng += m.lng; stage = worse(stage, m.stage)
      bounds.north = Math.max(bounds.north, m.lat); bounds.south = Math.min(bounds.south, m.lat)
      bounds.east = Math.max(bounds.east, m.lng); bounds.west = Math.min(bounds.west, m.lng)
    }
    clusters.push({ key, lat: lat / members.length, lng: lng / members.length, count: members.length, ids: members.map((m) => m.id), stage, bounds })
  }
  return { singles, clusters }
}

// Is this point inside the visible map, with a margin (a fraction of the view) so markers just off the edge are ready when it is dragged?
export function inView(lat: number, lng: number, view: Bounds | null, margin = 0.25): boolean {
  if (!view) return true
  const dLat = (view.north - view.south) * margin
  const dLng = (view.east >= view.west ? view.east - view.west : 360 + view.east - view.west) * margin
  if (lat > view.north + dLat || lat < view.south - dLat) return false
  // A view that crosses the antimeridian has west > east; Odisha never does, but stay correct.
  return view.east >= view.west
    ? lng >= view.west - dLng && lng <= view.east + dLng
    : lng >= view.west - dLng || lng <= view.east + dLng
}
