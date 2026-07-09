export interface QuickPick {
  label: string
  value: Date | null // null = "Now"
  sub?: string
}

const TIME_FMT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }

function fmt12(d: Date): string {
  return d.toLocaleString('en-IN', TIME_FMT).replace('AM', 'am').replace('PM', 'pm')
}

// Rounds up to the next 15-minute mark (dispatch buffers on 15-min increments anyway).
export function ceil15(d: Date): Date {
  const ms = 15 * 60_000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

export function getQuickPicks(min: Date, max: Date): QuickPick[] {
  const now = new Date()
  const inOneHour = ceil15(min)

  const picks: QuickPick[] = [
    { label: 'Now', value: null },
    { label: 'In 1 hour', value: inOneHour, sub: fmt12(inOneHour) },
  ]

  const tonight9pm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0)
  if (tonight9pm >= min && tonight9pm <= max && now.getHours() < 22) {
    picks.push({ label: 'Tonight', value: tonight9pm, sub: '9:00 pm' })
  } else {
    const tomorrowEvening = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0)
    if (tomorrowEvening >= min && tomorrowEvening <= max) {
      picks.push({ label: 'Tomorrow', value: tomorrowEvening, sub: '6:00 pm' })
    }
  }

  const tomorrow8am = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0)
  const tomorrowMorning = tomorrow8am < min ? ceil15(min) : tomorrow8am
  if (tomorrowMorning <= max) {
    picks.push({ label: 'Tomorrow', value: tomorrowMorning, sub: fmt12(tomorrowMorning) })
  }

  return picks
}
