import { createHash } from 'crypto'
import * as repo from './analytics.repository'
import { takeRate } from './kpi-definitions'
import type { ParsedRange } from './analytics.range'
import type {
  AnalyticsSummary, EtaAccuracy, DriverOnboardingFunnel, DriverAvailability,
  KpisResponse, FinanceResponse, DriversResponse, DemandResponse,
} from './analytics.types'
import { client as redis, withTimeout } from '@/db/redis'
import { analyticsCacheRequestsTotal } from '@/observability/metrics'
import { logger } from '@/lib/logger'

// ── Role class (eng D6/D10, CEO E5) ───────────────────────────────────────────
// The single place that decides who may see money. super_admin and finance_admin are
// `finance`; everyone else who can reach analytics (ops_admin) is `ops`.
export type RoleClass = 'finance' | 'ops'

export function roleClassOf(role: string): RoleClass {
  return role === 'super_admin' || role === 'finance_admin' ? 'finance' : 'ops'
}

// ── Response cache (eng D10): 60 s, key = endpoint + filters + role class ─────
const CACHE_TTL_SECONDS = 60

function cacheKey(endpoint: string, p: ParsedRange, roleClass: RoleClass): string {
  const h = createHash('sha256')
    .update(JSON.stringify({ from: p.from, to: p.to, compare: p.compare, f: p.filters }))
    .digest('hex')
    .slice(0, 24)
  return `analytics:v1:${endpoint}:${roleClass}:${h}`
}

// Redis trouble never fails a request: bypass the cache and query the database directly.
async function cached<T>(endpoint: string, p: ParsedRange, roleClass: RoleClass, build: () => Promise<T>): Promise<T> {
  const key = cacheKey(endpoint, p, roleClass)
  try {
    const hit = await withTimeout(redis.get(key))
    if (hit !== null) {
      analyticsCacheRequestsTotal.inc({ result: 'hit' })
      return JSON.parse(hit) as T
    }
    analyticsCacheRequestsTotal.inc({ result: 'miss' })
  } catch (err) {
    analyticsCacheRequestsTotal.inc({ result: 'bypass' })
    logger.warn({ err, endpoint }, 'analytics cache read failed, bypassing')
    return build()
  }
  const value = await build()
  try {
    await withTimeout(redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS))
  } catch (err) {
    logger.warn({ err, endpoint }, 'analytics cache write failed')
  }
  return value
}

// ── Money stripping for ops_admin (CEO E5): fields are removed, never zeroed ──
function stripTotalsMoney<T extends { gross_bookings?: number; commission?: number }>(t: T): T {
  const copy = { ...t }
  delete copy.gross_bookings
  delete copy.commission
  return copy
}

export async function getKpis(p: ParsedRange, roleClass: RoleClass): Promise<KpisResponse> {
  return cached('kpis', p, roleClass, async () => {
    const [totals, previous_totals, series, previous_series] = await Promise.all([
      repo.getKpiTotals(p.range, p.filters),
      p.previous ? repo.getKpiTotals(p.previous, p.filters) : Promise.resolve(null),
      repo.getDailySeries(p.range, p.filters),
      p.previous ? repo.getDailySeries(p.previous, p.filters) : Promise.resolve(null),
    ])
    const hide = roleClass === 'ops'
    const cleanSeries = (s: typeof series) =>
      hide ? s.map(({ gross: _g, commission: _c, ...rest }) => rest) : s
    return {
      from: p.from, to: p.to, compare: p.compare, generated_at: new Date().toISOString(),
      totals: hide ? stripTotalsMoney(totals) : totals,
      previous_totals: previous_totals ? (hide ? stripTotalsMoney(previous_totals) : previous_totals) : null,
      series: cleanSeries(series),
      previous_series: previous_series ? cleanSeries(previous_series) : null,
      money_hidden: hide,
    }
  })
}

// Legacy /summary shape (existing consumers). Ops gets no revenue, city revenue or earnings.
export async function getAnalyticsSummary(p: ParsedRange, roleClass: RoleClass): Promise<AnalyticsSummary> {
  return cached('summary', p, roleClass, async () => {
    const [series, funnel, top, cities, cats] = await Promise.all([
      repo.getDailySeries(p.range, p.filters),
      repo.getRideFunnel(p.range, p.filters),
      repo.getTopDrivers(p.range, p.filters),
      repo.getCityBreakdown(p.range, p.filters),
      repo.getCategoryBreakdown(p.range, p.filters),
    ])
    const hide = roleClass === 'ops'
    const out: AnalyticsSummary = {
      period_days: p.days, from: p.from, to: p.to, funnel,
      top_drivers: top.map(t => {
        if (!hide) return t
        const { total_earnings: _e, ...rest } = t
        return rest
      }),
      city_breakdown: cities.map(c => {
        if (!hide) return c
        const { revenue: _r, ...rest } = c
        return rest
      }),
      category_breakdown: cats.map(c => {
        if (!hide) return c
        const { revenue: _r, ...rest } = c
        return rest
      }),
    }
    if (!hide) out.daily_revenue = series.map(s => ({ day: s.day, revenue: s.gross, ride_count: s.completed_rides }))
    return out
  })
}

// Finance tab: the route restricts to the finance class.
export async function getFinance(p: ParsedRange): Promise<FinanceResponse> {
  return cached('finance', p, 'finance', async () => {
    const [totals, previous, finance, cash] = await Promise.all([
      repo.getKpiTotals(p.range, p.filters),
      p.previous ? repo.getKpiTotals(p.previous, p.filters) : Promise.resolve(null),
      repo.getFinanceTotals(p.range, p.filters),
      repo.getCashDiscrepancy(p.range, p.filters),
    ])
    return {
      from: p.from, to: p.to, generated_at: new Date().toISOString(),
      totals, take_rate: takeRate(totals), previous_take_rate: previous ? takeRate(previous) : null,
      finance, cash,
    }
  })
}

// Driver quality has earnings; ops sees the operational columns only.
export async function getDrivers(p: ParsedRange, roleClass: RoleClass): Promise<DriversResponse> {
  return cached('drivers', p, roleClass, async () => {
    const quality = await repo.getDriverQuality(p.range, p.filters)
    return {
      from: p.from, to: p.to, generated_at: new Date().toISOString(),
      quality: roleClass === 'ops' ? quality.map(({ earnings: _e, ...rest }) => rest) : quality,
    }
  })
}

export async function getDemand(p: ParsedRange, roleClass: RoleClass): Promise<DemandResponse> {
  return cached('demand', p, roleClass, async () => {
    const [funnel, heatmap, cancellations, cities, categories] = await Promise.all([
      repo.getRideFunnel(p.range, p.filters),
      repo.getDemandHeatmap(p.range, p.filters),
      repo.getCancellations(p.range, p.filters),
      repo.getCityBreakdown(p.range, p.filters),
      repo.getCategoryBreakdown(p.range, p.filters),
    ])
    const hide = roleClass === 'ops'
    return {
      from: p.from, to: p.to, generated_at: new Date().toISOString(),
      funnel, heatmap, cancellations,
      cities: hide ? cities.map(({ revenue: _r, ...rest }) => rest) : cities,
      categories: hide ? categories.map(({ revenue: _r, ...rest }) => rest) : categories,
    }
  })
}

export async function getEtaAccuracy(p: ParsedRange): Promise<EtaAccuracy[]> {
  return repo.getEtaAccuracy(p.range)
}

export async function getDriverOnboardingFunnel(p: ParsedRange): Promise<DriverOnboardingFunnel[]> {
  return repo.getDriverOnboardingFunnel(p.range)
}

// Live snapshot: never cached.
export async function getDriverAvailability(): Promise<DriverAvailability[]> {
  return repo.getDriverAvailability()
}
