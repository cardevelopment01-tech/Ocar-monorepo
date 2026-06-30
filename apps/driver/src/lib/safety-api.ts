import api from './api'

export const driverSafetyApi = {
  triggerSos: async (params: {
    rideId: string
    lat?: number
    lng?: number
    severity?: 'low' | 'medium' | 'high'
  }): Promise<void> => {
    const body: Record<string, unknown> = {
      rideId:   params.rideId,
      severity: params.severity ?? 'high',
    }
    if (params.lat !== undefined) body['lat'] = params.lat
    if (params.lng !== undefined) body['lng'] = params.lng
    await api.post('/api/v1/safety/sos', body)
  },
}
