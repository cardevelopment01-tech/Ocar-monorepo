/** Last "still here" from a driver's app (ms epoch). Redis, not the database: it is written every ~20 s per online driver. */
export const driverHeartbeatKey = (driverId: string): string => `driver:hb:${driverId}`
/** Throttle: the server accepts at most one heartbeat per driver per few seconds, whatever the client sends. */
export const driverHeartbeatThrottleKey = (driverId: string): string => `driver:hb:throttle:${driverId}`

/** Set by the idle sweep when IT paused a driver (value = session id), so a later heartbeat can resume them after a network blip. A pause the
 *  driver chose never sets it, so a heartbeat never overrides a deliberate pause. */
export const driverSweepPausedKey = (driverId: string): string => `driver:sweep-paused:${driverId}`

export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`

/** Set when a ride request ended for a driver; a ride-request push that has not gone out yet checks it and stays unsent. */
export const rideGoneKey = (rideId: string, driverId: string): string =>
  `ride:gone:${rideId}:${driverId}`

export const ridePushSentKey = (rideId: string, driverId: string): string =>
  `ride:push_sent:${rideId}:${driverId}`

export const startOtpKey = (rideId: string): string => `ride:start_otp:${rideId}`
export const endOtpKey   = (rideId: string): string => `ride:end_otp:${rideId}`

export const walletTopupOrderKey = (orderId: string): string => `wallet:topup_order:${orderId}`

export const ridePaymentOrderKey = (orderId: string): string => `ride:payment_order:${orderId}`

export const activeRideByDriverKey = (driverId: string): string => `ride:active_by_driver:${driverId}`
export const activeRideByUserKey = (userId: string): string => `ride:active_by_user:${userId}`
// The route of a ride's current leg, kept for the shadow ETA comparison (limits.ts ETA_SHADOW_*).
export const etaShadowLegKey = (rideId: string): string => `ride:eta_shadow_leg:${rideId}`

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
  cityId: number | null,
  tripMode: 'standard' | 'city' = 'standard'
): string {
  // v2: the key now carries the trip mode, so a standard and a city card for the same city and category never share an entry.
  return `ref:v2:rate_card:${version}:${categoryId}:${rideType}:${cityId ?? 'global'}:${tripMode}`
}

// Coordinates rounded to 4 decimal places (~11m precision) so nearby-identical
// requests hit the same cache entry. Options are folded into the key since they
// change the response shape (e.g. withSteps adds a steps array).
export const payuConfirmCooldownKey = (txnId: string): string => `payu:confirm:${txnId}`

export const routeKey = (
  originLat: number, originLng: number, destLat: number, destLng: number,
  opts?: { language?: string; withSteps?: boolean; trafficAware?: boolean; withTrafficIntervals?: boolean },
): string => {
  const r = (n: number) => n.toFixed(4)
  const o = `${opts?.language ?? 'en'}:${opts?.withSteps ? 1 : 0}:${opts?.trafficAware ? 1 : 0}:${opts?.withTrafficIntervals ? 1 : 0}`
  return `geo:route:${r(originLat)},${r(originLng)}:${r(destLat)},${r(destLng)}:${o}`
}

// One push per ride + recipient + event, so a retried status transition never double-notifies.
export const rideEventPushKey = (rideId: string, event: string, ownerId: string): string =>
  `ride:${rideId}:event-push:${event}:${ownerId}`
