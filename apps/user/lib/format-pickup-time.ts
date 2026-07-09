function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const TIME_FMT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }

// "Today, 6:30 pm" | "Tomorrow, 8:00 am" | "Wed 16, 6:30 pm"
export function formatPickupTime(d: Date): string {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const time = d.toLocaleString('en-IN', TIME_FMT).replace('AM', 'am').replace('PM', 'pm')

  if (isSameDay(d, now)) return `Today, ${time}`
  if (isSameDay(d, tomorrow)) return `Tomorrow, ${time}`

  const dayLabel = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })
  return `${dayLabel}, ${time}`
}
