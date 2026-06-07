export interface VehicleCategory {
  id: string
  slug: string
  display_name: string
  max_passengers: number
  is_active: boolean
}

export interface VehicleBrand {
  id: string
  name: string
  logo_url: string | null
  is_active: boolean
}

export interface VehicleModel {
  id: string
  brand_id: string
  name: string
  typical_category_id: string | null
  is_active: boolean
}
