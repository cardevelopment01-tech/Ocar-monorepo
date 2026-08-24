export const OTP_LENGTH = 6
export const RIDE_OTP_LENGTH = 4
export const OTP_TTL_SECONDS = 300
export const OTP_MAX_ATTEMPTS = 10
export const OTP_LOCK_DURATION_MINUTES = 5
export const OTP_RATE_LIMIT_WINDOW_MINUTES = 5
export const OTP_RATE_LIMIT_MAX_REQUESTS = 10
// Ride OTP (4-digit, DB-stored) brute-force protection. Independent of the
// login-OTP limiter (OTP_MAX_ATTEMPTS) — only the attempt COUNTER lives in
// Redis; the OTP hash itself stays in rides.start_otp_hash/end_otp_hash.
export const RIDE_OTP_MAX_ATTEMPTS = 5
export const RIDE_OTP_LOCKOUT_SECONDS = 15 * 60

export const JWT_ACCESS_EXPIRY = '15m'
export const JWT_REFRESH_EXPIRY_USER = '30d'
export const JWT_REFRESH_EXPIRY_ADMIN = '24h'
export const REFRESH_TOKEN_BYTES = 32
export const BCRYPT_ROUNDS = 12

export const BROADCAST_WINDOW_SECONDS = 20
export const BROADCAST_MAX_DRIVERS = 5
export const BROADCAST_ROUND_MAX = 3
// A driver whose tab backgrounded (pauseAvailability, is_available=false,
// ds.status stays 'online') within this many seconds is still matched into
// broadcasts and push-notified immediately, rather than being invisible
// until they reopen the app on their own.
export const BACKGROUND_MATCH_GRACE_SECONDS = 60
// Longer per-assignment response window for a backgrounded match than a live
// one — realistic time to notice a push, tap it, and let the app reconnect.
export const BACKGROUND_ACCEPT_WINDOW_SECONDS = 45
// Admin manual-assign: longer than a broadcast ping since the driver was
// deliberately picked and deserves a beat to check the trip before responding.
export const MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS = 30
// How long a force-assigned (no accept step) driver has to show GPS activity
// before the ride auto-reverts to unassigned and flags the admin.
export const FORCE_ASSIGN_GRACE_MINUTES = 4

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

// Idle "online" (not on_trip) driver whose GPS ping has gone stale — see
// cleanup.worker.ts's idle-heartbeat sweep. Two tiers: pull from the matching
// pool fast (cheap, reversible — a driver's tab backgrounding is the primary,
// client-reported path, this is only the backstop for a real crash/OS-kill),
// end the session only after a much longer silence.
export const IDLE_HEARTBEAT_PAUSE_SECONDS = 90
export const IDLE_HEARTBEAT_OFFLINE_MINUTES = 10

export const RATE_CARD_CACHE_TTL_SECONDS = 3600 // 1h — money-affecting, short backstop TTL
export const CONFIG_CACHE_TTL_SECONDS = 30 // kill switches — bounds worst-case staleness only; a real flip is invalidated immediately
export const STRUCTURAL_CACHE_TTL_SECONDS = 21600 // 6h — structural, changes are rare and deliberate
export const NOTIFICATION_TEMPLATE_CACHE_TTL_SECONDS = 900 // 15min — edited via admin UI, keep the feedback loop tight
