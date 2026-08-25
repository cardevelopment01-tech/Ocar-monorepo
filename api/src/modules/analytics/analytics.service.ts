import * as repo from './analytics.repository'
import type {
  AnalyticsSummary, EtaAccuracy, DriverOnboardingFunnel, DriverAvailability,
} from './analytics.types'

export async function getAnalyticsSummary(days: number): Promise<AnalyticsSummary> {
  const [daily_revenue, funnel, top_drivers, city_breakdown, category_breakdown] =
    await Promise.all([
      repo.getDailyRevenue(days),
      repo.getRideFunnel(days),
      repo.getTopDrivers(days),
      repo.getCityBreakdown(days),
      repo.getCategoryBreakdown(days),
    ])

  return { period_days: days, daily_revenue, funnel, top_drivers, city_breakdown, category_breakdown }
}

export async function getEtaAccuracy(days: number): Promise<EtaAccuracy[]> {
  return repo.getEtaAccuracy(days)
}

export async function getDriverOnboardingFunnel(days: number): Promise<DriverOnboardingFunnel[]> {
  return repo.getDriverOnboardingFunnel(days)
}

export async function getDriverAvailability(): Promise<DriverAvailability[]> {
  return repo.getDriverAvailability()
}
