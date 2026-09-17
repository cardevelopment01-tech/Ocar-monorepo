import { api } from '@/services/api'

export type ProfileStats = {
  name: string | null
  email: string | null
  phone: string | null
  total_rides: number
  rating_avg: number | null
  wallet_balance: number
}

export async function fetchProfile(): Promise<ProfileStats> {
  const res = await api.get('/api/v1/users/me')
  return res.data.user as ProfileStats
}

export async function updateProfile(data: { full_name: string; email?: string }): Promise<ProfileStats> {
  const res = await api.patch('/api/v1/users/me', data)
  return res.data.user as ProfileStats
}
