// Map cells for the live "cars near you" feed on a searching rider's map.
//
// The world is cut into a grid of 0.02-degree cells (about 2.2 km north-south, and 1.8-2.2 km east-west across India's
// latitudes). A driver's position is published to the cell it is in; a searching rider listens to the 5x5 block of cells
// around their pickup. The block always reaches at least two cell-widths (3.5 km) in every direction from the pickup, so
// every car within 3.5 km of it is covered: the rider's map frames and shows cars within 3 km. Pure: no I/O, so each rule
// is unit-tested. The rider never chooses cells -- the server derives them from the rider's own searching ride.

/** Cells per degree (a cell is 1 / CELLS_PER_DEG degrees wide). An integer, so cell indices are exact. */
export const CELLS_PER_DEG = 50
/** The rider listens to the cell they are in plus this many cells each way (2 => 5x5 = 25 cells). */
export const CELL_RING = 2
/** Every car within this distance of the pickup is inside the listened block, at any latitude up to 37 N. */
export const GUARANTEED_RADIUS_M = 3500
/** Room / Redis channel prefix. Separate from the socket.io adapter's own channels. */
export const NEARBY_ROOM_PREFIX = 'nearby:'

export type Cell = { i: number; j: number }

export function cellOf(lat: number, lng: number): Cell {
  return { i: Math.floor(lat * CELLS_PER_DEG), j: Math.floor(lng * CELLS_PER_DEG) }
}

export function roomOfCell(c: Cell): string {
  return `${NEARBY_ROOM_PREFIX}${c.i}:${c.j}`
}

/** The room a car at this position is published to. */
export function roomOfPoint(lat: number, lng: number): string {
  return roomOfCell(cellOf(lat, lng))
}

/** The rooms a rider at `lat,lng` listens to: the cell they are in and the ring around it (25 rooms). */
export function roomsAround(lat: number, lng: number, ring = CELL_RING): string[] {
  const c = cellOf(lat, lng)
  const rooms: string[] = []
  for (let di = -ring; di <= ring; di++) {
    for (let dj = -ring; dj <= ring; dj++) rooms.push(roomOfCell({ i: c.i + di, j: c.j + dj }))
  }
  return rooms
}
