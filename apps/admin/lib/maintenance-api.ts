import api from './api'

export interface MaintenanceStatus {
  enabled: boolean
  message?: string
  retryAfterSeconds?: number
}

export const maintenanceApi = {
  get: async (): Promise<MaintenanceStatus> => {
    const { data } = await api.get<{ maintenance: MaintenanceStatus }>('/api/v1/admin/maintenance')
    return data.maintenance
  },

  update: async (status: MaintenanceStatus): Promise<MaintenanceStatus> => {
    const { data } = await api.patch<{ maintenance: MaintenanceStatus }>('/api/v1/admin/maintenance', status)
    return data.maintenance
  },
}
