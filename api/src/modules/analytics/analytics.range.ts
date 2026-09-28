import { z } from 'zod'
import {
  istDayStartUtc,
  rangeFromIstDates,
  previousRange,
  todayIstDate,
  type KpiFilters,
  type TimeRange,
} from './kpi-definitions'

// One shared parser for every analytics route (replaces the per-handler VALID_PERIODS blocks).
// Accepts either a preset (`period=7d|30d|90d`, backward compatible) or IST calendar dates
// (`from`/`to`, inclusive), plus optional city/category filters and the comparison toggle.

export const MAX_RANGE_DAYS = 366
export const MAX_CITY_IDS = 50
const DAY_MS = 86_400_000
const PRESET_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')

const querySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  cityIds: z.string().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  compare: z.enum(['prev', 'off']).default('prev'),
})

export interface ParsedRange {
  from: string // IST date, inclusive
  to: string // IST date, inclusive
  days: number
  range: TimeRange
  previous: TimeRange | null // null when compare=off
  filters: KpiFilters
  compare: 'prev' | 'off'
}

export class InvalidRangeError extends Error {
  readonly code = 'ANALYTICS_INVALID_RANGE'
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRangeError'
  }
}

function isRealDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function shiftDate(date: string, deltaDays: number): string {
  return new Date(istDayStartUtc(date).getTime() + deltaDays * DAY_MS + 5.5 * 3600_000)
    .toISOString()
    .slice(0, 10)
}

/** Throws InvalidRangeError (mapped to HTTP 400 by the routes). `now` is injectable for tests. */
export function parseRange(query: Record<string, unknown>, now: Date = new Date()): ParsedRange {
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new InvalidRangeError(`${first?.path.join('.') || 'query'}: ${first?.message ?? 'invalid'}`)
  }
  const q = parsed.data

  let from: string
  let to: string
  if (q.from !== undefined || q.to !== undefined) {
    if (q.from === undefined || q.to === undefined) {
      throw new InvalidRangeError('from and to must be given together')
    }
    if (!isRealDate(q.from) || !isRealDate(q.to)) throw new InvalidRangeError('from/to must be real dates')
    from = q.from
    to = q.to
  } else {
    const days = PRESET_DAYS[q.period ?? '30d'] as number
    to = todayIstDate(now)
    from = shiftDate(to, -(days - 1))
  }
  if (from > to) throw new InvalidRangeError('from must not be after to')
  const range = rangeFromIstDates(from, to)
  const days = Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS)
  if (days > MAX_RANGE_DAYS) throw new InvalidRangeError(`range must not exceed ${MAX_RANGE_DAYS} days`)

  const filters: KpiFilters = {}
  if (q.cityIds !== undefined && q.cityIds !== '') {
    const ids = q.cityIds.split(',').map((s) => s.trim())
    if (ids.length > MAX_CITY_IDS) throw new InvalidRangeError(`cityIds must not exceed ${MAX_CITY_IDS}`)
    if (!ids.every((s) => /^\d+$/.test(s))) throw new InvalidRangeError('cityIds must be comma-separated integers')
    filters.cityIds = ids.map(Number)
  }
  if (q.categoryId !== undefined) filters.categoryId = q.categoryId

  return {
    from,
    to,
    days,
    range,
    previous: q.compare === 'prev' ? previousRange(range) : null,
    filters,
    compare: q.compare,
  }
}
