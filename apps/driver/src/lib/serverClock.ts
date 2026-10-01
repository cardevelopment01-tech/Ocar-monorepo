// Server-corrected "now". A driver's phone clock can be minutes off, which would shift the booked-time
// clock into the wrong state; every API response carries the server's `Date` header, so keep the offset.
let skewMs = 0

export function noteServerDate(dateHeader: unknown): void {
  if (typeof dateHeader !== 'string') return
  const server = Date.parse(dateHeader)
  if (!Number.isNaN(server)) skewMs = server - Date.now()
}

export const serverNow = (): number => Date.now() + skewMs
