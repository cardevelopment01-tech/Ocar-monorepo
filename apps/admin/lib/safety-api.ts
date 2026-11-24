import api from './api'

export type SosAlert = {
  id: string
  ride_id: string
  severity: 'low' | 'medium' | 'high'
  status: 'triggered' | 'acknowledged' | 'responding' | 'resolved' | 'false_alarm'
  triggered_by_user: string | null
  triggered_by_driver: string | null
  user_name: string | null
  user_phone: string | null
  driver_name: string | null
  driver_phone: string | null
  origin_address: string | null
  destination_address: string | null
  location_lat: string | null
  location_lng: string | null
  notes: string | null
  acknowledged_by: string | null
  acknowledged_by_email: string | null
  acknowledged_at: string | null
  resolved_by_email: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
}

/** Whole-table totals by status, from the server (not counted from the rows on screen). */
export type SosCounts = Record<'triggered' | 'acknowledged' | 'responding' | 'resolved' | 'false_alarm', number>

export type SosDetail = SosAlert & {
  ride_status: string
  pickup_lat: number | null
  pickup_lng: number | null
  rider_name: string | null
  rider_phone: string | null
  number_plate: string | null
  vehicle_name: string | null
  previous_alerts: number
  trail: { lat: number; lng: number; recorded_at: string; speed_kmph: number | null }[]
}

export type Dispute = {
  id: string
  ride_id: string
  initiator: 'user' | 'driver' | 'admin'
  type: string
  description: string
  status: string
  priority: number
  user_name: string | null
  user_phone: string | null
  driver_name: string | null
  driver_phone: string | null
  origin_address: string | null
  destination_address: string | null
  outcome: string | null
  outcome_note: string | null
  assigned_to: string | null
  assigned_to_email: string | null
  sla_hours: number
  sla_due_at: string
  resolved_at: string | null
  created_at: string
  actions?: {
    id: string
    action_type: string
    note: string | null
    admin_email: string
    created_at: string
  }[]
}

export type GpsTrailPoint = {
  lat: number
  lng: number
  recorded_at: string
  speed_kmph: number | null
  heading: number | null
}

export type TripReplay = {
  actualTrail: GpsTrailPoint[]
  plannedRoute: { polyline: string } | null
}

export const safetyApi = {
  // SOS
  // status: 'active' = every still-open alert; or one exact status.
  getSosAlerts: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<{ alerts: SosAlert[]; total: number; counts: SosCounts }>('/api/v1/admin/safety/sos', { params }).then(r => r.data),

  getSosDetail: (id: string) =>
    api.get<SosDetail>(`/api/v1/admin/safety/sos/${id}`).then(r => r.data),

  acknowledgeSos: (id: string) =>
    api.patch<SosAlert>(`/api/v1/admin/safety/sos/${id}/acknowledge`).then(r => r.data),

  resolveSos: (id: string, body: { status?: 'resolved' | 'false_alarm'; note?: string }) =>
    api.patch<SosAlert>(`/api/v1/admin/safety/sos/${id}/resolve`, body).then(r => r.data),

  // Disputes
  getDisputes: (params?: { status?: string; assignedToMe?: boolean; limit?: number; offset?: number }) =>
    api.get<{ disputes: Dispute[]; total: number }>('/api/v1/admin/safety/disputes', { params }).then(r => r.data),

  getDispute: (id: string) =>
    api.get<Dispute>(`/api/v1/admin/safety/disputes/${id}`).then(r => r.data),

  assignDispute: (id: string) =>
    api.patch<Dispute>(`/api/v1/admin/safety/disputes/${id}/assign`).then(r => r.data),

  resolveDispute: (id: string, body: { outcome: string; note: string; refundAmount?: number }) =>
    api.patch<Dispute>(`/api/v1/admin/safety/disputes/${id}/resolve`, body).then(r => r.data),

  getTripReplay: (disputeId: string) =>
    api.get<TripReplay>(`/api/v1/admin/safety/disputes/${disputeId}/trip-replay`).then(r => r.data),
}
