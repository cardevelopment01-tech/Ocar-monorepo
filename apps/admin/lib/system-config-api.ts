import api from './api'

export interface SystemConfig {
  id: string
  key: string
  value: string
  valueType: string
  description: string | null
  isPublic: boolean
  status: string
  updatedAt: string
  /** Inclusive numeric range the API enforces on save; null = unbounded. */
  min: number | null
  max: number | null
}

export const systemConfigApi = {
  list: async (): Promise<SystemConfig[]> => {
    const { data } = await api.get<{ config: SystemConfig[] }>('/api/v1/admin/system-config')
    return data.config
  },

  /**
   * `expectedUpdatedAt` is the updatedAt this screen last saw. If someone else saved in
   * the meantime the API answers 409 CONFIG_CHANGED instead of overwriting them.
   */
  update: async (id: string, value: string, expectedUpdatedAt?: string): Promise<SystemConfig & { warnings?: string[] }> => {
    const body: { value: string; expectedUpdatedAt?: string } = { value }
    if (expectedUpdatedAt !== undefined) body.expectedUpdatedAt = expectedUpdatedAt
    const { data } = await api.patch<{ config: SystemConfig; warnings?: { message: string }[] }>(`/api/v1/admin/system-config/${id}`, body)
    // The save went through; warnings are things the admin should know (e.g. unpaid discounted rides when commission is restored).
    return data.warnings?.length ? { ...data.config, warnings: data.warnings.map((w) => w.message) } : data.config
  },
}
