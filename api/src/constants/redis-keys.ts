export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`

export const ridePushSentKey = (rideId: string, driverId: string): string =>
  `ride:push_sent:${rideId}:${driverId}`

export const startOtpKey = (rideId: string): string => `ride:start_otp:${rideId}`
export const endOtpKey   = (rideId: string): string => `ride:end_otp:${rideId}`

export const walletTopupOrderKey = (orderId: string): string => `wallet:topup_order:${orderId}`

export const ridePaymentOrderKey = (orderId: string): string => `ride:payment_order:${orderId}`

export const activeRideByDriverKey = (driverId: string): string => `ride:active_by_driver:${driverId}`

export const RATE_CARD_VERSION_KEY = 'ref:v1:rate_card:ver'

export function rateCardKey(
  version: string,
  categoryId: number,
  rideType: string,
  cityId: number | null
): string {
  return `ref:v1:rate_card:${version}:${categoryId}:${rideType}:${cityId ?? 'global'}`
}

// Coordinates rounded to 4 decimal places (~11m precision) so nearby-identical
// requests hit the same cache entry. Options are folded into the key since they
// change the response shape (e.g. withSteps adds a steps array).
export const routeKey = (
  originLat: number, originLng: number, destLat: number, destLng: number,
  opts?: { language?: string; withSteps?: boolean; trafficAware?: boolean; withTrafficIntervals?: boolean },
): string => {
  const r = (n: number) => n.toFixed(4)
  const o = `${opts?.language ?? 'en'}:${opts?.withSteps ? 1 : 0}:${opts?.trafficAware ? 1 : 0}:${opts?.withTrafficIntervals ? 1 : 0}`
  return `geo:route:${r(originLat)},${r(originLng)}:${r(destLat)},${r(destLng)}:${o}`
}
