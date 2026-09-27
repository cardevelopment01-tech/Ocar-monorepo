import { query } from '@/db/client'
import { cachedRead } from '@/lib/cache/reference-cache'
import { VEHICLE_CATEGORIES_ALL_KEY } from '@/constants/redis-keys'
import { STRUCTURAL_CACHE_TTL_SECONDS } from '@/constants/limits'
import type { VehicleCategory, VehicleBrand, VehicleModel } from './vehicles.types'

export async function getCategories(): Promise<VehicleCategory[]> {
  return cachedRead(
    'vehicle_categories',
    VEHICLE_CATEGORIES_ALL_KEY,
    STRUCTURAL_CACHE_TTL_SECONDS,
    fetchAllVehicleCategoriesFromDb
  ) as Promise<VehicleCategory[]>
}

// Client-requested display order (not alphabetical): auto, hatchback, sedan, suv, luxury, van.
const CATEGORY_DISPLAY_ORDER = ['auto_rickshaw', 'hatchback', 'sedan', 'suv', 'luxury', 'van']

async function fetchAllVehicleCategoriesFromDb(): Promise<VehicleCategory[]> {
  const categories = await query<VehicleCategory>(
    'SELECT id::int, slug, display_name, max_passengers, is_active FROM vehicle_categories WHERE is_active = true'
  )
  return categories.sort((a, b) => {
    const ai = CATEGORY_DISPLAY_ORDER.indexOf(a.slug)
    const bi = CATEGORY_DISPLAY_ORDER.indexOf(b.slug)
    if (ai === -1 && bi === -1) return a.display_name.localeCompare(b.display_name)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export async function getBrands(): Promise<VehicleBrand[]> {
  return query<VehicleBrand>(
    'SELECT id::int, name, logo_url, is_active FROM vehicle_brands WHERE is_active = true ORDER BY name'
  )
}

export async function getModelsByBrand(brandId: number): Promise<VehicleModel[]> {
  return query<VehicleModel>(
    'SELECT id::int, brand_id::int, name, typical_category_id::int, is_active FROM vehicle_models WHERE brand_id = $1 AND is_active = true ORDER BY name',
    [brandId]
  )
}
