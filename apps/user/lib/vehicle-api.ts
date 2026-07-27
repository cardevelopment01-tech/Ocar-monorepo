import api from './api'

export type VehicleCategory = {
  id: number
  slug: string
  display_name: string
  max_passengers: number
}

export const vehicleApi = {
  getCategories: async (): Promise<VehicleCategory[]> => {
    const res = await api.get('/api/v1/vehicles/categories')
    return res.data as VehicleCategory[]
  },
}
