export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`

export const ridePushSentKey = (rideId: string, driverId: string): string =>
  `ride:push_sent:${rideId}:${driverId}`

export const startOtpKey = (rideId: string): string => `ride:start_otp:${rideId}`
export const endOtpKey   = (rideId: string): string => `ride:end_otp:${rideId}`

export const walletTopupOrderKey = (orderId: string): string => `wallet:topup_order:${orderId}`

export const ridePaymentOrderKey = (orderId: string): string => `ride:payment_order:${orderId}`

export const activeRideByDriverKey = (driverId: string): string => `ride:active_by_driver:${driverId}`

export function configKey(key: string): string {
  return `ref:v1:config:${key}`
}

export const RATE_CARD_VERSION_KEY = 'ref:v1:rate_card:ver'

export const CITIES_ALL_KEY = 'ref:v1:cities:all'

export const VEHICLE_CATEGORIES_ALL_KEY = 'ref:v1:vehicle_categories:all'

export function cityByIdKey(id: number | bigint): string {
  return `ref:v1:city:${id}`
}

export function rentalPackageKey(packageId: number): string {
  return `ref:v1:rental_package:${packageId}`
}

export const PACKAGE_TIERS_ALL_KEY = 'ref:v1:package_tiers:all'

// stop_charges and category_fallback_rules are both read scoped by a single
// category_id, not as a flat list-all — key per category, not one _ALL_KEY.
export function stopChargeKey(categoryId: number): string {
  return `ref:v1:stop_charge:${categoryId}`
}

export function categoryFallbackKey(categoryId: number | bigint): string {
  return `ref:v1:category_fallback:${categoryId}`
}

// rating_tag_definitions is read scoped by an optional applies_to filter.
export function ratingTagsKey(appliesTo?: string): string {
  return `ref:v1:rating_tags:${appliesTo ?? 'all'}`
}

export function notificationTemplateKey(slug: string, channel: string, locale: string): string {
  return `ref:v1:notification_template:${slug}:${channel}:${locale}`
}

export function surgeKey(cityId: number, categoryId: number): string {
  return `ref:v1:surge:${cityId}:${categoryId}`
}

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
