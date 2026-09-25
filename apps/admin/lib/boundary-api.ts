import api from './api'

// Matches api/src/modules/admin/admin.types.ts's CityBoundaryGeoJson/Analysis/Write —
// see docs/superpowers/specs/2026-09-25-admin-city-boundary-editor-plan.md.

export interface CityBoundaryGeoJson {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export interface CityBoundaryAnalysis {
  isValid: boolean
  invalidReason: string | null
  vertexCount: number
  areaKm2: number
  bboxKm: { widthKm: number; heightKm: number }
  centroidInside: boolean | null
  overlaps: Array<{ cityId: number; name: string; pctOfNew: number }>
}

export interface CityBoundaryWrite {
  boundary: CityBoundaryGeoJson
  previousBoundary: CityBoundaryGeoJson | null
  updatedAt: string
}

export const boundaryApi = {
  get: (cityId: number) =>
    api.get(`/api/v1/admin/geo/cities/${cityId}/boundary`)
      .then(r => r.data as { name: string; boundary: CityBoundaryGeoJson | null; updatedAt: string }),

  preview: (cityId: number, geojson: CityBoundaryGeoJson) =>
    api.post(`/api/v1/admin/geo/cities/${cityId}/boundary/preview`, { geojson })
      .then(r => r.data as CityBoundaryAnalysis),

  save: (cityId: number, geojson: CityBoundaryGeoJson, expectedUpdatedAt: string) =>
    api.put(`/api/v1/admin/geo/cities/${cityId}/boundary`, { geojson, expectedUpdatedAt })
      .then(r => r.data as CityBoundaryWrite),

  remove: (cityId: number, expectedUpdatedAt: string) =>
    api.delete(`/api/v1/admin/geo/cities/${cityId}/boundary`, { data: { expectedUpdatedAt } })
      .then(r => r.data as { previousBoundary: CityBoundaryGeoJson | null; updatedAt: string }),
}
