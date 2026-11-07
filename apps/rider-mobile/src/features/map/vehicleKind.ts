// Which top-down map icon a vehicle category gets. The server's category slugs have drifted between environments ('auto' live,
// 'auto_rickshaw' in the migration), so both map to the auto rickshaw; anything unknown draws as a sedan rather than nothing.

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
