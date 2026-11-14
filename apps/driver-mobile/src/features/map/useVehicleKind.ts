import { useEffect, useState } from 'react'
import { onboardingApi } from '@/features/onboarding/api'
import { vehicleKindOf, type VehicleKind } from './vehicleKind'

// category id -> slug, fetched once (GET /vehicles/categories is public and rarely changes). A failed fetch is not cached, so the next
// screen tries again; until it answers, the driver's own vehicle simply draws as a sedan.
let slugsById: Promise<Map<number, string>> | null = null
function categorySlugs(): Promise<Map<number, string>> {
  if (!slugsById) {
    slugsById = onboardingApi
      .getCategories()
      .then((rows) => new Map(rows.map((c) => [Number(c.id), c.slug] as const)))
      .catch(() => {
        slugsById = null
        return new Map<number, string>()
      })
  }
  return slugsById
}

/** The map image kind for the driver's own vehicle category. */
export function useVehicleKind(categoryId: number | null | undefined): VehicleKind {
  const [kind, setKind] = useState<VehicleKind>('sedan')
  useEffect(() => {
    if (categoryId == null) { setKind('sedan'); return }
    let live = true
    void categorySlugs().then((m) => { if (live) setKind(vehicleKindOf(m.get(Number(categoryId)))) })
    return () => { live = false }
  }, [categoryId])
  return kind
}
