// Which top-down map image a vehicle category gets, and how big it is. Same mapping as the rider app (features/map/vehicleKind.ts):
// the server's category slugs have drifted between environments ('auto' live, 'auto_rickshaw' in the migration), so both map to the
// auto rickshaw; anything unknown draws as a sedan rather than nothing.

export type VehicleKind = 'auto' | 'hatchback' | 'sedan' | 'suv' | 'luxury' | 'van'

const BY_SLUG: Record<string, VehicleKind> = {
  auto: 'auto',
  auto_rickshaw: 'auto',
  hatchback: 'hatchback',
  sedan: 'sedan',
  suv: 'suv',
  luxury: 'luxury',
  van: 'van',
}

export function vehicleKindOf(slug: string | null | undefined): VehicleKind {
  return slug && Object.prototype.hasOwnProperty.call(BY_SLUG, slug) ? BY_SLUG[slug]! : 'sedan'
}

/** Size of each image in dp (the 1x file is exactly this many pixels; the @2x/@3x/@4x files are multiples of it). */
export const MARKER_DP: Record<VehicleKind, { w: number; h: number }> = {
  hatchback: { w: 20, h: 32 },
  sedan: { w: 22, h: 36 },
  suv: { w: 24, h: 39 },
  luxury: { w: 22, h: 39 },
  van: { w: 24, h: 44 },
  auto: { w: 22, h: 30 },
}
