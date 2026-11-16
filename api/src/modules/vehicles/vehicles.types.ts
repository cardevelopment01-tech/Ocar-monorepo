export interface VehicleCategory {
  id: string
  slug: string
  display_name: string
  max_passengers: number
  luggage_capacity: number
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
  /** Fuel types the model is sold with; null = any. */
  fuel_types: string[] | null
  is_active: boolean
}
