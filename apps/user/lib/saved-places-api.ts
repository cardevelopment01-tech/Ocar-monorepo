import api from './api'

export type SavedPlaceKind = 'home' | 'work' | 'other'

export interface SavedPlace {
  id: string
  kind: SavedPlaceKind
  label: string
  address: string
  latitude: number
  longitude: number
}

export interface SavedPlaceInput {
  kind: SavedPlaceKind
  label?: string
  address: string
  latitude: number
  longitude: number
}

export const savedPlacesApi = {
  list: async (): Promise<SavedPlace[]> => {
    const { data } = await api.get<{ places: SavedPlace[] }>('/api/v1/saved-places')
    return data.places
  },

  create: async (input: SavedPlaceInput): Promise<SavedPlace> => {
    const { data } = await api.post<{ place: SavedPlace }>('/api/v1/saved-places', input)
    return data.place
  },

  update: async (id: string, input: Omit<SavedPlaceInput, 'kind'>): Promise<SavedPlace> => {
    const { data } = await api.patch<{ place: SavedPlace }>(`/api/v1/saved-places/${id}`, input)
    return data.place
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/saved-places/${id}`)
  },
}
