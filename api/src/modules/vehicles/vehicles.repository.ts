import { query } from '@/db/client'
import type { VehicleCategory, VehicleBrand, VehicleModel } from './vehicles.types'

export async function getCategories(): Promise<VehicleCategory[]> {
  return query<VehicleCategory>(
    'SELECT id::int, slug, display_name, max_passengers, is_active FROM vehicle_categories WHERE is_active = true ORDER BY display_name'
  )
}

export async function getBrands(): Promise<VehicleBrand[]> {
  return query<VehicleBrand>(
    'SELECT id, name, logo_url, is_active FROM vehicle_brands WHERE is_active = true ORDER BY name'
  )
}

export async function getModelsByBrand(brandId: number): Promise<VehicleModel[]> {
  return query<VehicleModel>(
    'SELECT id, brand_id, name, typical_category_id, is_active FROM vehicle_models WHERE brand_id = $1 AND is_active = true ORDER BY name',
    [brandId]
  )
}
