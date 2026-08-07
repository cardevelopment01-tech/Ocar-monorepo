export const OTP_LENGTH = 6
export const RIDE_OTP_LENGTH = 4
export const OTP_TTL_SECONDS = 300
export const OTP_MAX_ATTEMPTS = 10
export const OTP_LOCK_DURATION_MINUTES = 5
export const OTP_RATE_LIMIT_WINDOW_MINUTES = 5
export const OTP_RATE_LIMIT_MAX_REQUESTS = 10

export const JWT_ACCESS_EXPIRY = '15m'
export const JWT_REFRESH_EXPIRY_USER = '30d'
export const JWT_REFRESH_EXPIRY_ADMIN = '24h'
export const REFRESH_TOKEN_BYTES = 32
export const BCRYPT_ROUNDS = 12

export const BROADCAST_WINDOW_SECONDS = 20
export const BROADCAST_MAX_DRIVERS = 5
export const BROADCAST_ROUND_MAX = 3

export const GPS_FLUSH_INTERVAL_SECONDS = 30
export const GPS_ACCURACY_THRESHOLD_METRES = 50
export const GPS_TRAIL_RETENTION_DAYS = 90
export const SPEED_LIMIT_CITY_KMPH = 50
export const SPEED_LIMIT_HIGHWAY_KMPH = 70

export const DRIVER_MIN_WALLET_BALANCE = 500
export const CASHBACK_RIDE_PERCENT = 0.05
export const CASHBACK_EXPIRY_DAYS = 30
export const REFERRAL_REFERRER_BONUS = 100
export const REFERRAL_REFEREE_BONUS = 50
export const REFERRAL_UNLOCK_AFTER_RIDES = 1

export const GEOCODE_CACHE_TTL_DAYS = 90
// notification_logs retention — read items are no longer actionable quickly,
// unread ones are kept longer in case the owner hasn't opened the app yet.
export const NOTIFICATION_READ_RETENTION_DAYS = 30
export const NOTIFICATION_UNREAD_RETENTION_DAYS = 90
// Backstop under whatever cadence callers refetch at (e.g. driver nav polling) —
// see docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md Phase 1 item 3 cost math.
export const ROUTE_CACHE_TTL_SECONDS = 90
// Driver turn-by-turn reroute tuning (apps/driver/src/lib/useTurnByTurn.ts mirrors
// these locally — the driver app can't import server constants — keep both in sync).
export const OFF_ROUTE_THRESHOLD_METRES = 40
export const OFF_ROUTE_CONSECUTIVE_FIXES = 2
export const REROUTE_COOLDOWN_SECONDS = 12
// Voice-announce distance-before-maneuver policy (Google doesn't supply this timing
// metadata — see docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md §4 provider decision).
export const MANEUVER_ANNOUNCE_FAR_METRES = 300
export const MANEUVER_ANNOUNCE_NEAR_METRES = 100
// Ceiling stays readable on a 360px route card and matches the majors' cap
// (Uber tops out at 2 extra stops) — see docs/MULTI_STOP_PLAN.md §2.1.
export const MAX_STOPS_PER_RIDE = 3
export const STOP_DUPLICATE_RADIUS_METRES = 100
// Free wait window per stop before metered wait kicks in (one-way only — an
// intercity stop is an errand, so 10 min, not the 3-min city-handoff cap).
// Beyond this, wait is billed at the rate card's rate_per_min. See docs research.
export const STOP_FREE_WAIT_MINUTES = 10
export const ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES = 15
export const MIN_ADVANCE_BOOKING_MINUTES = 60
export const MAX_ADVANCE_BOOKING_DAYS = 7
export const MAX_CONCURRENT_SCHEDULED_BOOKINGS = 3
export const RETURN_CAB_MATCH_RADIUS_METRES = 2000
// Khorda/Bhubaneswar/Cuttack share one boundary box (see 055_merge_khorda_bbsr_ctc_boundary.sql)
// so a genuine Bhubaneswar<->Cuttack intercity trip can still land inside it. Only block
// one_way/round_trip as "book a City Ride instead" when the trip is actually short.
export const IN_CITY_MAX_TRIP_DISTANCE_METRES = 15_000

export const PAGINATION_DEFAULT_LIMIT = 20
export const PAGINATION_MAX_LIMIT = 100

// How long a ride can sit in a non-terminal status before it's treated as
// orphaned (broadcast job died, driver app crashed mid-flow, etc.) — both
// for excluding it from "is this user's active ride" lookups and for the
// cleanup sweep that actually force-resolves it. Gated on updated_at, not
// requested_at, so advance-booking dispatch (which bumps updated_at when it
// flips 'scheduled' -> 'requested') is never mistaken for stale.
export const STALE_REQUESTED_MINUTES = 20
export const STALE_ACCEPTED_HOURS = 3
export const STALE_DRIVER_ARRIVED_HOURS = 1
export const STALE_IN_PROGRESS_CEILING_HOURS = 12
