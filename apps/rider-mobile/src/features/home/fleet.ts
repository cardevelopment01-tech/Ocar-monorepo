import { useEffect, useState } from 'react'
import type { ImageSourcePropType } from 'react-native'
import { fetchVehicleCategories } from '@/features/booking/api'
import autoImg from '../../../assets/home/fleet-auto.png'
import hatchbackImg from '../../../assets/home/fleet-hatchback.png'
import sedanImg from '../../../assets/home/fleet-sedan.png'
import luxuryImg from '../../../assets/home/fleet-luxury.png'
import vanImg from '../../../assets/home/fleet-van.png'

export type FleetItem = { key: string; slug: string; name: string; seats: number; desc: string; image: ImageSourcePropType | null }

// Card copy from the reference's "Our Fleet" screen. The categories API has no
// description column, so copy is keyed by slug; unknown slugs get a neutral line.
const COPY: Record<string, { desc: string; image: ImageSourcePropType | null }> = {
  auto: { desc: 'Quick, affordable hops for short local legs', image: autoImg },
  auto_rickshaw: { desc: 'Quick, affordable hops for short local legs', image: autoImg },
  hatchback: { desc: 'Light and easy for quick trips around town', image: hatchbackImg },
  sedan: { desc: 'Comfortable and efficient for everyday outstation trips', image: sedanImg },
  luxury: { desc: 'Our finest cars, chauffeur-driven for special occasions', image: luxuryImg },
  suv: { desc: 'Roomy and relaxed for family and group journeys', image: null },
  van: { desc: 'Tempo travellers for weddings, pilgrimages and group trips', image: vanImg },
}
/** Reference vehicle render for a category slug (null -> caller falls back to the shared VehicleIcon). */
export const fleetImageFor = (slug: string): ImageSourcePropType | null => COPY[slug]?.image ?? null

const ORDER = ['auto', 'auto_rickshaw', 'hatchback', 'sedan', 'luxury', 'suv', 'van']

// Offline / first-paint fallback, exactly the five vehicles in the reference.
const FALLBACK: FleetItem[] = [
  { slug: 'auto', name: 'Auto Rickshaw', seats: 3 },
  { slug: 'hatchback', name: 'Hatchback', seats: 4 },
  { slug: 'sedan', name: 'Sedan', seats: 4 },
  { slug: 'luxury', name: 'Luxury', seats: 4 },
  { slug: 'van', name: 'Van', seats: 17 },
].map((v) => ({ ...v, key: v.slug, desc: COPY[v.slug]!.desc, image: COPY[v.slug]!.image }))

let cache: FleetItem[] | null = null

export function useFleet(): FleetItem[] {
  const [items, setItems] = useState<FleetItem[]>(cache ?? FALLBACK)
  useEffect(() => {
    if (cache) return
    let live = true
    fetchVehicleCategories()
      .then((cats) => {
        const next = cats
          .filter((c) => c.isActive)
          .sort((a, b) => (ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99))
          .map((c) => ({
            key: String(c.id),
            slug: c.slug,
            name: c.displayName,
            seats: c.maxPassengers,
            desc: COPY[c.slug]?.desc ?? 'Chauffeur-driven, ready when you are',
            image: COPY[c.slug]?.image ?? null,
          }))
        if (next.length) cache = next
        if (live && next.length) setItems(next)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return items
}
