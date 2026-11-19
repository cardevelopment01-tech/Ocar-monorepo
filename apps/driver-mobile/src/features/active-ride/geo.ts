// Shared by ActiveRideMap.tsx (route-deviation check) and speedAlert.ts
// (city-radius classification) -- previously two identical copies in the
// same feature folder, one touched by the same diff that introduced the
// other (code-review finding, 2026-09-22).
// Mirrors @ocar/shared's AT_PICKUP_M (the rider apps' "driver is at the pickup" radius), so the driver is told
// to tap Arrived at the same moment the rider is told the driver is there. This app doesn't depend on @ocar/shared.
export const AT_PICKUP_M = 75

export function haversineMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
