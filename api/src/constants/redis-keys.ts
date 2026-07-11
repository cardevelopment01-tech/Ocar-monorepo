export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`

export const startOtpKey = (rideId: string): string => `ride:start_otp:${rideId}`
export const endOtpKey   = (rideId: string): string => `ride:end_otp:${rideId}`

export const walletTopupOrderKey = (orderId: string): string => `wallet:topup_order:${orderId}`

// Coordinates rounded to 4 decimal places (~11m precision) so nearby-identical
// requests hit the same cache entry. Options are folded into the key since they
// change the response shape (e.g. withSteps adds a steps array).
export const routeKey = (
  originLat: number, originLng: number, destLat: number, destLng: number,
  opts?: { language?: string; withSteps?: boolean; trafficAware?: boolean },
): string => {
  const r = (n: number) => n.toFixed(4)
  const o = `${opts?.language ?? 'en'}:${opts?.withSteps ? 1 : 0}:${opts?.trafficAware ? 1 : 0}`
  return `geo:route:${r(originLat)},${r(originLng)}:${r(destLat)},${r(destLng)}:${o}`
}
