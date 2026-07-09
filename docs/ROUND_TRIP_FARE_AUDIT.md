# Round Trip Fare — Client Feedback Audit

Date received: 2026-07-05  
Source: Client message (morning)

---

## Summary of client issues

Two separate problems reported:

1. **Round trip distance counted as one-way only** — fare is calculated on the one-way km to the destination, not the full round-trip km (pickup → drop → pickup).
2. **Early termination of a round trip is not handled** — if a user ends the trip at a location other than the original pickup, there is no logic to charge them the extra km needed to return the driver to the origin, nor any notification to users at booking time that this policy exists.

---

## Issue 1 — Round Trip Distance Is One-Way Only

### What the client wants

> "Running kms should be calculated as total distance of running (starting from pickup point and ending at pickup point)."

A round trip is pickup → destination → pickup. The total running km is **2 × one-way distance** (plus any stop detours). The fare should be charged on the full round-trip km.

### Where the bug lives

**`apps/user/app/(main)/round-trip/page.tsx` lines 31, 65**  
`distanceKm` is read from search params as the one-way distance and passed unchanged to `/select-ride`:

```ts
const distanceKm = sp.get('distanceKm') ? parseFloat(sp.get('distanceKm')!) : null
// ...
distanceKm: String(distanceKm),   // ← passed to /select-ride as-is
```

The UI even acknowledges this is one-way (line 163):
```tsx
<span>{distanceKm} km each way</span>
```

But it never doubles the value before passing to the booking/estimate flow.

**`api/src/lib/fare.ts` `calculateFare()` — no doubling for round trips**  
The fare engine receives `estimated_km` and multiplies it by `rate_per_km`. There is no branch that doubles `estimated_km` when `ride_type === 'round_trip'`.

The `hour_surcharge` (`trip_hours × hour_rate`) is correctly added for round trips (line 83–85), but `distance_fare` = `estimated_km × rate_per_km` is always one-way.

**`api/src/modules/rides/rides.service.ts` `createBooking()` line 231**  
`fare_snapshots.estimated_km` is stored as `data.distanceKm` — the one-way value. This is also used later when `total_final = total_estimated` on completion.

**`api/src/modules/pricing/pricing.service.ts` `getFareEstimate()` line 63**  
`distance_km: req.distance_km` is passed straight through to `estimateFare()` — no round-trip multiplication.

### What needs to change

| Location | Change |
|---|---|
| `apps/user/app/(main)/round-trip/page.tsx` | Double `distanceKm` before passing to `/select-ride`, OR label clearly and let the fare engine handle it |
| `api/src/lib/fare.ts` `calculateFare()` | When `ride_type === 'round_trip'`, multiply `estimated_km` by 2 before computing `distance_fare` |
| `api/src/modules/pricing/pricing.service.ts` | No change needed if fare engine handles it |
| `apps/user/app/(main)/round-trip/page.tsx` UI label | Update "km each way" display to show both legs (e.g., "2 × 120 km = 240 km total") |
| `fare_snapshots.estimated_km` | Store the doubled value at booking so actual vs estimated comparison is meaningful |

> **Decision needed:** Should the doubling happen in the frontend (pass `2 × distanceKm` to the API) or in the fare engine (engine doubles when `ride_type === 'round_trip'`)? The engine approach is safer — it means the backend is the single source of truth and the driver app / admin estimates also benefit automatically.

---

## Issue 2 — Early Termination of a Round Trip Ride

### What the client wants

> "If a user books a round trip ride and after trip started, user has to end the trip on midway apart from his source location — at that case O CAR will not charge the user total package fare, we have to calculate a exact one way distance km from user's drop location to pickup location and add that km to user's running km and time and toll fare also, as per that calculations user has to pay."
>
> "And this should be notified to user when a user makes booking."

### What currently happens

**`api/src/modules/rides/rides.service.ts` `verifyEndOTP()` lines 654–725**  
When the driver taps "End Trip" and submits the end OTP with `actual_distance_km` and `actual_duration_min`:

```ts
await repo.updateRideStatus(rideId, 'completed', {
  completed_at:        completedAt,
  actual_distance_km:  actualDistanceKm  ?? null,
  actual_duration_min: actualDurationMin ?? null,
})
// ...
await pool.query(
  `UPDATE fare_snapshots
   SET actual_km    = $2,
       actual_min   = $3,
       total_final  = total_estimated,   // ← ALWAYS charges the original estimate
       status       = 'final',
       finalised_at = now()
   WHERE ride_id = $1`,
  [rideId, actualDistanceKm, actualDurationMin]
)
```

`total_final = total_estimated` means the user is **always charged the original estimate**, regardless of whether they ended early. There is no check for early round trip termination.

**`apps/driver/src/lib/ride-api.ts` line 116**  
The driver sends `actual_distance_km` as the GPS-tracked distance only — this is the actual km driven to the early stop, not including the return leg.

### What needs to change

**Backend — `verifyEndOTP` in `rides.service.ts`**

When `ride_type === 'round_trip'` and the actual drop point is materially different from `origin_lat/origin_lng`, the service needs to:

1. **Detect early termination** — compare the driver's actual end coordinates (from GPS or from the ride's `dest_lat/dest_lng` if the user set a new drop) against `rides.origin_lat / origin_lng`. If they differ beyond a threshold (e.g., >500 m), it is an early termination.
2. **Compute return distance** — call the Geo/PostGIS layer to get the straight-line or road distance from the actual drop point back to `origin_lat/origin_lng`. This is the "deadhead" km the driver must travel.
3. **Add to running km/min** — `total_running_km = actual_distance_km + return_distance_km`. Similarly estimate `return_duration_min` and add to `actual_duration_min`.
4. **Recalculate fare** — run `calculateFare` with `ride_type = 'one_way'` (no `hour_surcharge`), `estimated_km = total_running_km`, `estimated_min = total_min`, using the same rate card and surge multiplier from `fare_snapshots`.
5. **Update `fare_snapshots`** — store `total_final` as the recalculated amount (not `total_estimated`), and store `actual_km`, `actual_min` as the combined values.
6. **Emit socket event** — tell the user app the revised fare so the ride completion screen shows the correct amount.

**Driver app — `TripInProgress.tsx` / end OTP flow**

The driver app currently sends `actual_distance_km` and `actual_duration_min`. It may also need to send the final GPS coordinates at trip end (`actual_end_lat`, `actual_end_lng`) so the backend can compute the return distance without guessing.

**Database — `fare_snapshots` table**

May need two new nullable columns:
- `early_termination_km` — the return deadhead km added
- `early_termination_min` — estimated return time added

This preserves the original `actual_km` and makes the breakdown auditable.

**User notification at booking time — `apps/user/app/(main)/round-trip/page.tsx`**

The "What's included" info block (lines 215–228) currently says:
```
- Same driver for both legs — no second booking needed
- Fare covers travel, waiting time, and the return
- Minimum booking duration is 4 hours
```

Add a fourth bullet explaining early termination policy:
```
- If you end early at a different location, the return distance to pickup is added to your fare
```

---

## Issue interaction

Issue 1 (one-way km) feeds into Issue 2. If the base fare estimate is already wrong (one-way), then even the early-termination recalculation will use the wrong baseline. Fix Issue 1 first — get the round-trip km correct — then implement early-termination logic on top of that correct baseline.

---

## Files to touch (in implementation order)

| # | File | What |
|---|---|---|
| 1 | `api/src/lib/fare.ts` | Double `estimated_km` when `ride_type === 'round_trip'` in `calculateFare()` |
| 2 | `apps/user/app/(main)/round-trip/page.tsx` | Update distance display label; optionally double on frontend too |
| 3 | `api/src/modules/rides/rides.service.ts` | `verifyEndOTP` — early termination detection + fare recalculation |
| 4 | `apps/driver/src/lib/ride-api.ts` | Send `actual_end_lat` / `actual_end_lng` on end-OTP call |
| 5 | `apps/user/app/(main)/round-trip/page.tsx` | Add early-termination policy bullet to info block |
| 6 | DB migration (new) | Add `early_termination_km`, `early_termination_min` to `fare_snapshots` if desired |

---

## Open questions before implementation

1. **Fare engine or frontend doubles the km?** — Recommend fare engine (backend). Keeps admin estimates and driver app consistent.
2. **How to detect "actual end coords" at trip end?** — Driver GPS at OTP moment, or does the driver app explicitly send the end coordinates? Currently the end-OTP route only receives `actual_distance_km` / `actual_duration_min`.
3. **Toll fare for return leg** — Client mentions "toll fare also". Toll is currently not modelled in the fare engine (no toll field in `rate_cards`). This may need a separate stub or user-entered toll field for the early-termination case.
4. **Early termination threshold** — What distance from origin counts as "not at pickup"? Recommend 500 m radius as the cutoff.
5. **Does `hour_surcharge` apply at all for early termination?** — If the user ends early, presumably the `trip_hours` package no longer applies and the ride should be billed purely on metered `one_way` rates. Confirm with client.
