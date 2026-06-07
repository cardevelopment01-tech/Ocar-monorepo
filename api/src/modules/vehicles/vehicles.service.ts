import * as repo from './vehicles.repository'
import type { VehicleCategory, VehicleBrand, VehicleModel } from './vehicles.types'

export async function getCategories(): Promise<VehicleCategory[]> {
  return repo.getCategories()
}

export async function getBrands(): Promise<VehicleBrand[]> {
  return repo.getBrands()
}

export async function getModels(brandId: number): Promise<VehicleModel[]> {
  return repo.getModelsByBrand(brandId)
}
