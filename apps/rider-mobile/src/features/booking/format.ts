/** "45 min", "1 hr", "6 hrs", "6h 30m": how long a trip or package lasts. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hrs = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${hrs} hr${hrs > 1 ? 's' : ''}` : `${hrs}h ${m}m`
}
