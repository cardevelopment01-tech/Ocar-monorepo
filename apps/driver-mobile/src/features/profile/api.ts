import { api } from '@/services/api'

export type DriverStats = {
  total_rides: number
  rating_avg: number | null
  top_tags: { label: string; count: number }[]
}

export type DriverOnboarding = {
  missing_documents: string[]
}

export async function fetchDriverStats(): Promise<{ stats: DriverStats; onboarding: DriverOnboarding }> {
  const res = await api.get('/api/v1/drivers/me')
  return res.data as { stats: DriverStats; onboarding: DriverOnboarding }
}

export async function updateDriverProfile(data: { full_name: string; email?: string }): Promise<{ full_name: string; email: string | null }> {
  const res = await api.patch('/api/v1/drivers/me', data)
  return res.data.driver as { full_name: string; email: string | null }
}
