import api from './api'

export type VehicleState = 'pending' | 'active' | 'blacklisted' | 'inactive'

export interface VehicleCategory {
  id: string; slug: string; display_name: string
  max_passengers: number; is_active: boolean
  created_at: string; driver_count: number
}

export interface VehicleBrand {
  id: string; name: string; logo_url: string | null
  is_active: boolean; created_at: string; model_count: number
}

export interface VehicleModel {
  id: string; brand_id: string; name: string
  typical_category_id: string | null; is_active: boolean
  created_at: string; brand_name: string; typical_category_name: string | null
}

export interface FleetVehicle {
  id: string; driver_id: string; driver_name: string | null
  driver_code: string; driver_phone: string
  vehicle_name: string | null; number_plate: string | null
  category: string | null; brand: string | null
  status: VehicleState; is_primary: boolean; created_at: string
}

export interface PendingVehicleDoc {
  id: string; vehicle_id: string; doc_type: string
  file_url: string; doc_number: string | null
  status: string; created_at: string
  number_plate: string | null; vehicle_name: string | null
  driver_name: string | null; driver_code: string
}

export interface ExpiringVehicleDoc {
  id: string; vehicle_id: string; doc_type: string
  file_url: string; valid_until: string
  number_plate: string | null; vehicle_name: string | null
  driver_name: string | null; driver_phone: string; driver_code: string
}

export const vehicleCategoryApi = {
  list: () => api.get('/api/v1/admin/vehicles/categories').then(r => r.data as VehicleCategory[]),
  create: (body: { slug: string; display_name: string; max_passengers: number; is_active: boolean }) =>
    api.post('/api/v1/admin/vehicles/categories', body).then(r => r.data as VehicleCategory),
  update: (id: string, body: { display_name?: string; max_passengers?: number; is_active?: boolean }) =>
    api.patch(`/api/v1/admin/vehicles/categories/${id}`, body).then(r => r.data as VehicleCategory),
}

export const vehicleBrandApi = {
  list: () => api.get('/api/v1/admin/vehicles/brands').then(r => r.data as VehicleBrand[]),
  create: (body: { name: string; is_active: boolean }) =>
    api.post('/api/v1/admin/vehicles/brands', body).then(r => r.data as VehicleBrand),
  update: (id: string, body: { name?: string; is_active?: boolean }) =>
    api.patch(`/api/v1/admin/vehicles/brands/${id}`, body).then(r => r.data as VehicleBrand),
}

export const vehicleModelApi = {
  list: (brandId?: string) =>
    api.get('/api/v1/admin/vehicles/models', { params: brandId ? { brand_id: brandId } : {} }).then(r => r.data as VehicleModel[]),
  create: (body: { brand_id: string; name: string; typical_category_id?: string | null; is_active: boolean }) =>
    api.post('/api/v1/admin/vehicles/models', body).then(r => r.data as VehicleModel),
  update: (id: string, body: { name?: string; typical_category_id?: string | null; is_active?: boolean }) =>
    api.patch(`/api/v1/admin/vehicles/models/${id}`, body).then(r => r.data as VehicleModel),
}

export const fleetApi = {
  list: (status?: string) =>
    api.get('/api/v1/admin/vehicles/fleet', { params: status ? { status } : {} }).then(r => r.data as FleetVehicle[]),
  blacklist: (vehicleId: string, reason: string) =>
    api.patch(`/api/v1/admin/vehicles/fleet/${vehicleId}/blacklist`, { reason }).then(r => r.data as { success: boolean; driver_suspended: boolean }),
  unblacklist: (vehicleId: string) =>
    api.patch(`/api/v1/admin/vehicles/fleet/${vehicleId}/unblacklist`).then(r => r.data),
}

export const vehicleDocApi = {
  listPending: () => api.get('/api/v1/admin/vehicles/documents/pending').then(r => r.data as PendingVehicleDoc[]),
  listExpiring: (daysAhead = 30) =>
    api.get('/api/v1/admin/vehicles/documents/expiring', { params: { days_ahead: daysAhead } }).then(r => r.data as ExpiringVehicleDoc[]),
  approve: (docId: string) =>
    api.patch(`/api/v1/admin/vehicles/documents/${docId}/approve`).then(r => r.data),
  reject: (docId: string, rejection_note: string) =>
    api.patch(`/api/v1/admin/vehicles/documents/${docId}/reject`, { rejection_note }).then(r => r.data),
}
