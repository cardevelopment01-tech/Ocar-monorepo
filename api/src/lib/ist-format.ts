// Times in rider-facing messages are always Indian Standard Time, whatever the server's own zone is.
const IST = 'Asia/Kolkata'

/** "Thu 26 Nov, 6:30 pm" */
export function fmtPickup(d: Date): string {
  const day = d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
  return `${day}, ${fmtClock(d)}`
}

/** "6:30 pm" */
export function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ').toLowerCase()
}
