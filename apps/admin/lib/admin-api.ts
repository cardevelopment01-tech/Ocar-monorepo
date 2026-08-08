import api from './api'

export type DriverStatus = 'pending_docs' | 'pending_approval' | 'active' | 'suspended' | 'banned' | 'docs_rejected'

export interface DriverListItem {
  id: string
  code: string
  phone: string
  full_name: string | null
  email: string | null
  status: DriverStatus
  onboarding_step: string
  created_at: string
  vehicle: {
    number_plate: string
    vehicle_name: string
    category: string
  } | null
  docs_submitted: number
  docs_approved: number
}

export interface DriverDetail {
  id: string
  code: string
  phone: string
  full_name: string | null
  email: string | null
  gender: string | null
  date_of_birth: string | null
  residential_address: string | null
  state: string | null
  city: string | null
  pincode: string | null
  experience_years: number | null
  emergency_contact: string | null
  languages_known: string[]
  aadhaar_number: string | null
  license_number: string | null
  city_id: string | null
  assigned_city_name: string | null
  assigned_city_billing_mode: 'commission' | 'package' | null
  status: DriverStatus
  onboarding_step: string
  created_at: string
  updated_at: string
  vehicle: {
    id: string
    number_plate: string
    vehicle_name: string
    model_year: number
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    category: string
    brand: string
    category_id: string | null
    brand_id: string | null
    model_id: string | null
  } | null
  documents: { id: string; doc_type: string; file_url: string; status: string; rejection_note: string | null }[]
  vehicle_documents: { id: string; doc_type: string; file_url: string; status: string; rejection_note: string | null }[]
  status_history: { from_status: string | null; to_status: string; reason: string | null; created_at: string }[]
  wallet: { balance: string; is_frozen: boolean } | null
  rating_avg: string
  total_ratings: number
  ratings: { id: string; score: number; comment: string | null; created_at: string; ride_id: string; tags: string[] }[]
  warnings: { id: string; category: string; severity: string; description: string; acknowledged_at: string | null; expires_at: string | null; created_at: string; issued_by_email: string | null }[]
  recent_rides: { id: string; status: string; ride_type: string; requested_at: string; completed_at: string | null; fare: string | null; user_name: string }[]
}

export interface DriversResponse {
  drivers: DriverListItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export interface DriverPaymentRow {
  id: string
  status: string
  channel: string
  created_at: string
  amount: string
  commission_amount: string
  driver_earning: string
  ride_id: string
  user_name: string
}

export interface DriverAuditLogEntry {
  id: string
  admin_id: string | null
  admin_email: string | null
  admin_role: string | null
  action: string
  target_table: string
  target_id: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  ip_address: string | null
  reason: string | null
  created_at: string
}

export const adminDriverApi = {
  list: async (params: {
    status?: string
    search?: string
    page?: number
    limit?: number
  }): Promise<DriversResponse> => {
    const res = await api.get('/api/v1/admin/drivers', { params })
    return res.data as DriversResponse
  },

  getById: async (id: string): Promise<DriverDetail> => {
    const res = await api.get(`/api/v1/admin/drivers/${id}`)
    return res.data as DriverDetail
  },

  approve: async (id: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'active' })
  },

  rejectDocs: async (id: string, reason: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'docs_rejected', reason })
  },

  ban: async (id: string, reason: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'banned', reason })
  },

  suspend: async (id: string, reason: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'suspended', reason })
  },

  reinstate: async (id: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'active' })
  },

  approveDriverDoc: async (docId: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/documents/${docId}/approve`)
  },

  rejectDriverDoc: async (docId: string, rejectionNote: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/documents/${docId}/reject`, { rejection_note: rejectionNote })
  },

  updateProfile: async (
    id: string,
    fields: Partial<{
      full_name: string; email: string; gender: string; date_of_birth: string
      residential_address: string; state: string; city: string; pincode: string
      experience_years: number; emergency_contact: string; languages_known: string[]
      aadhaar_number: string; license_number: string; city_id: string
    }>,
    reason: string
  ): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/profile`, { ...fields, reason })
  },

  updateVehicle: async (
    id: string,
    fields: Partial<{
      category_id: string; brand_id: string; model_id: string | null
      vehicle_name: string; number_plate: string; model_year: number
      color: string; fuel_type: string; seating_capacity: number
      luggage_capacity: number; ac_availability: boolean
    }>,
    reason: string
  ): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/vehicle`, { ...fields, reason })
  },

  rides: async (id: string, page = 1, limit = 20): Promise<{ rides: DriverDetail['recent_rides']; pagination: { total: number; page: number; limit: number; pages: number } }> => {
    const res = await api.get(`/api/v1/admin/drivers/${id}/rides`, { params: { page, limit } })
    return res.data as { rides: DriverDetail['recent_rides']; pagination: { total: number; page: number; limit: number; pages: number } }
  },

  payments: async (id: string, page = 1, limit = 20): Promise<{ payments: DriverPaymentRow[]; pagination: { total: number; page: number; limit: number; pages: number } }> => {
    const res = await api.get(`/api/v1/admin/drivers/${id}/payments`, { params: { page, limit } })
    return res.data as { payments: DriverPaymentRow[]; pagination: { total: number; page: number; limit: number; pages: number } }
  },

  auditLog: async (id: string, page = 1, limit = 20): Promise<{ entries: DriverAuditLogEntry[]; pagination: { total: number; page: number; limit: number; pages: number } }> => {
    const res = await api.get(`/api/v1/admin/drivers/${id}/audit-log`, { params: { page, limit } })
    return res.data as { entries: DriverAuditLogEntry[]; pagination: { total: number; page: number; limit: number; pages: number } }
  },

  approveVehicleDoc: async (docId: string): Promise<void> => {
    await api.patch(`/api/v1/admin/vehicles/documents/${docId}/approve`)
  },

  rejectVehicleDoc: async (docId: string, rejectionNote: string): Promise<void> => {
    await api.patch(`/api/v1/admin/vehicles/documents/${docId}/reject`, { rejection_note: rejectionNote })
  },
}

// ─── Rides ────────────────────────────────────────────────────────────────────

export interface AdminRideItem {
  id: string
  status: string
  ride_type: string
  is_return_cab: boolean
  origin_address: string | null
  destination_address: string | null
  requested_at: string
  accepted_at: string | null
  driver_arrived_at: string | null
  started_at: string | null
  completed_at: string | null
  review_flagged_at: string | null
  review_reason: string | null
  cash_discrepancy: boolean
  cash_collected_amount: string | null
  user_name: string
  user_phone: string
  driver_name: string | null
  driver_phone: string | null
  fare: string | null
  payment_status: string | null
  payment_channel: string | null
  cancellation_reason_code: string | null
  cancellation_reason: string | null
  cancellation_actor: string | null
}

export interface AdminRideStop {
  id: string
  sequence: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  arrived_at: string | null
  reached_at: string | null
  wait_charge: string
}

export interface AdminRideFareBreakdown {
  base_fare: string | null
  distance_fare: string | null
  time_fare: string | null
  stop_fare: string | null
  hour_surcharge: string | null
  overage_fare: string | null
  surge_fare: string | null
  surge_multiplier: string | null
  estimated_km: string | null
  estimated_min: string | null
  actual_km: string | null
  actual_min: string | null
  overage_km: string | null
  overage_min: string | null
  refund_amount: string | null
}

export interface AdminRideStatusEvent {
  from_status: string | null
  to_status: string
  actor: string
  note: string | null
  created_at: string
}

export interface AdminRideLinkedDispute { id: string; status: string; type: string }
export interface AdminRideLinkedSos { id: string; status: string; severity: string }
export interface AdminRideLinkedRating { direction: string; score: number; comment: string | null }

export interface AdminRideMessage {
  id: string
  senderType: 'user' | 'driver'
  senderId: string
  body: string
  readAt: string | null
  createdAt: string
}

export type AdminRideDetail = AdminRideItem & AdminRideFareBreakdown & {
  stops: AdminRideStop[]
  sos_triggered: boolean
  sos_triggered_at: string | null
  vehicle_number_plate: string | null
  vehicle_name: string | null
  vehicle_color: string | null
  cancellation_fee_applicable: boolean | null
  cancellation_fee_amount: string | null
  cancellation_fee_waived: boolean | null
  cancellation_fee_waived_reason: string | null
  status_history: AdminRideStatusEvent[]
  disputes: AdminRideLinkedDispute[]
  sos_alerts: AdminRideLinkedSos[]
  ratings: AdminRideLinkedRating[]
  messages: AdminRideMessage[]
}

export interface AdminRidesResponse {
  rides: AdminRideItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export interface AdminUpcomingRideItem {
  id: string
  ride_type: string
  scheduled_for: string
  origin_address: string | null
  destination_address: string | null
  user_name: string
  user_phone: string
  advance_status: string
  is_stuck: boolean
}

export const adminRideApi = {
  list: async (params: { status?: string; ride_type?: string; search?: string; cashDiscrepancy?: boolean; dateFrom?: string; dateTo?: string; cityId?: number; page?: number; limit?: number }): Promise<AdminRidesResponse> => {
    const res = await api.get('/api/v1/admin/rides', { params })
    return res.data as AdminRidesResponse
  },
  upcoming: async (): Promise<AdminUpcomingRideItem[]> => {
    const res = await api.get('/api/v1/admin/rides/upcoming')
    return (res.data as { rides: AdminUpcomingRideItem[] }).rides
  },
  getById: async (rideId: string): Promise<AdminRideDetail> => {
    const res = await api.get(`/api/v1/admin/rides/${rideId}`)
    return res.data as AdminRideDetail
  },
  forceResolve: async (rideId: string, action: 'complete' | 'cancel', note?: string): Promise<void> => {
    await api.post(`/api/v1/admin/rides/${rideId}/force-resolve`, { action, note })
  },
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AdminUserItem {
  id: string
  code: string
  name: string
  phone: string
  email: string | null
  status: string
  rating_avg: string | null
  total_rides: number
  wallet_balance: string
  created_at: string
}

export interface AdminUsersResponse {
  users: AdminUserItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const adminUserApi = {
  list: async (params: { status?: string; search?: string; page?: number; limit?: number }): Promise<AdminUsersResponse> => {
    const res = await api.get('/api/v1/admin/users', { params })
    return res.data as AdminUsersResponse
  },
  updateStatus: async (id: string, status: 'active' | 'suspended'): Promise<void> => {
    await api.patch(`/api/v1/admin/users/${id}/status`, { status })
  },
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface AdminPaymentItem {
  id: string
  status: string
  channel: string
  amount: string
  commission_amount: string
  driver_earning: string
  ride_id: string
  user_name: string
  driver_name: string | null
  created_at: string
}

export interface AdminPaymentsResponse {
  payments: AdminPaymentItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const adminPaymentApi = {
  list: async (params: { channel?: string; search?: string; page?: number; limit?: number }): Promise<AdminPaymentsResponse> => {
    const res = await api.get('/api/v1/admin/payments', { params })
    return res.data as AdminPaymentsResponse
  },
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export interface AdminDashboardStats {
  total_rides_today: number
  active_drivers_online: number
  revenue_today: number
  open_disputes: number
  completed_rides: number
  cancelled_rides: number
  new_driver_signups: number
  active_trips: number
  rides_last_12h: number[]
}

export const adminStatsApi = {
  get: async (): Promise<AdminDashboardStats> => {
    const res = await api.get('/api/v1/admin/stats')
    return res.data as AdminDashboardStats
  },
}

// ─── Live map ─────────────────────────────────────────────────────────────────

export interface ActiveDriverSession {
  session_id: string
  driver_id: string
  driver_name: string | null
  driver_phone: string
  driver_code: string
  session_status: 'online' | 'on_trip'
  lat: number | null
  lng: number | null
  heading: number | null
  speed_kmph: number | null
  location_updated_at: string | null
  ride_id: string | null
  origin_address: string | null
  destination_address: string | null
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  vehicle_category: string | null
  vehicle_name: string | null
  number_plate: string | null
}

export const adminSessionsApi = {
  getActive: async (): Promise<ActiveDriverSession[]> => {
    const res = await api.get('/api/v1/admin/sessions/active')
    return (res.data as { sessions: ActiveDriverSession[] }).sessions
  },
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface DailyRevenue   { day: string; revenue: number; ride_count: number }
export interface RideFunnel     { requested: number; accepted: number; completed: number; cancelled: number }
export interface TopDriver      { driver_id: string; driver_name: string | null; driver_code: string; trip_count: number; total_earnings: number; rating_avg: string | null }
export interface CityBreakdown  { city_name: string; ride_count: number; revenue: number }
export interface CategoryBreakdown { category_name: string; ride_count: number; revenue: number }

export interface AnalyticsSummary {
  period_days: number
  daily_revenue: DailyRevenue[]
  funnel: RideFunnel
  top_drivers: TopDriver[]
  city_breakdown: CityBreakdown[]
  category_breakdown: CategoryBreakdown[]
}

export const adminAnalyticsApi = {
  getSummary: async (period: '7d' | '30d' | '90d'): Promise<AnalyticsSummary> => {
    const res = await api.get('/api/v1/admin/analytics/summary', { params: { period } })
    return res.data as AnalyticsSummary
  },
}
