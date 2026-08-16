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
}

export const systemConfigApi = {
  list: async (): Promise<SystemConfig[]> => {
    const { data } = await api.get<{ config: SystemConfig[] }>('/api/v1/admin/system-config')
    return data.config
  },

  update: async (id: string, value: string): Promise<SystemConfig> => {
    const { data } = await api.patch<{ config: SystemConfig }>(`/api/v1/admin/system-config/${id}`, { value })
    return data.config
  },
}
