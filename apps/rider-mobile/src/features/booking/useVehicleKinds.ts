import { useEffect, useState } from 'react'
import { vehicleKindOf, type VehicleKind } from '@/features/map/vehicleKind'
import { fetchVehicleCategories } from './api'

export type VehicleKinds = { kinds: ReadonlyMap<number, VehicleKind>; slugs: ReadonlyMap<number, string> }
const NONE: VehicleKinds = { kinds: new Map(), slugs: new Map() }

/** Category id -> which icon it draws as, and its slug. The list is shared and cached with the booking screens; until it
 *  arrives (or if it cannot be fetched) everything draws as a sedan. */
export function useVehicleKinds(): VehicleKinds {
  const [value, setValue] = useState<VehicleKinds>(NONE)
  useEffect(() => {
    let cancelled = false
    fetchVehicleCategories()
      .then((cats) => {
        if (cancelled) return
        setValue({ kinds: new Map(cats.map((c) => [c.id, vehicleKindOf(c.slug)])), slugs: new Map(cats.map((c) => [c.id, c.slug])) })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return value
}
