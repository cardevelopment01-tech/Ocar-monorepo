import { useCallback, useEffect, useRef, useState } from 'react'
import type { FareEstimate, VehicleCategory } from '@ocar/mobile-shared'
import { fetchFareEstimate, fetchVehicleCategories, type RideType } from '../api'

export type FareEstimatesState = {
  categories: VehicleCategory[]
  estimates: Record<number, FareEstimate>
  loading: boolean
  error: string | null
  retry: () => void
}

// A plain debounce on distanceKm/durationMin/categoryId changes would still let
// a slow first response resolve after a fast second one and clobber the correct
// fare (this exact race is called out in the plan's Eng review). A monotonic
// request-generation counter fixes ordering directly: any response whose
// generation doesn't match the latest one fired is dropped, regardless of
// which network call happens to land first.
export function useFareEstimates(
  distanceKm: number | null,
  durationMin: number | null,
  originCityId: number | null,
  rideType: RideType = 'one_way',
  tripHours?: number | null
): FareEstimatesState {
  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [estimates, setEstimates] = useState<Record<number, FareEstimate>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const load = useCallback(() => {
    if (distanceKm === null || durationMin === null) return
    const generation = ++generationRef.current
    setLoading(true)
    setError(null)

    fetchVehicleCategories()
      .then(async (cats) => {
        if (generation !== generationRef.current) return
        setCategories(cats)

        const settled = await Promise.allSettled(
          cats.map((cat) => {
            const input: Parameters<typeof fetchFareEstimate>[0] = {
              categoryId: cat.id,
              rideType,
              distanceKm,
              durationMin,
            }
            if (originCityId !== null) input.cityId = originCityId
            if (rideType === 'round_trip' && tripHours != null) input.tripHours = tripHours
            return fetchFareEstimate(input)
          })
        )
        if (generation !== generationRef.current) return

        const next: Record<number, FareEstimate> = {}
        settled.forEach((result, i) => {
          if (result.status === 'fulfilled') next[cats[i]!.id] = result.value
        })
        setEstimates(next)
        setLoading(false)
        if (Object.keys(next).length === 0 && cats.length > 0) {
          setError("Couldn't get a fare estimate, try again")
        }
      })
      .catch(() => {
        if (generation !== generationRef.current) return
        setError("Couldn't get a fare estimate, try again")
        setLoading(false)
      })
  }, [distanceKm, durationMin, originCityId, rideType, tripHours])

  useEffect(() => {
    load()
  }, [load])

  return { categories, estimates, loading, error, retry: load }
}
