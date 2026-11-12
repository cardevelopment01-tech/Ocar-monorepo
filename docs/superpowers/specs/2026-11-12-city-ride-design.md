# City ride: a metered in-city mode, separate from hourly Rental

**Status:** draft for review. Decisions marked **(assumed)** need the owner's confirmation before Task 6.

## Why
Today an in-city trip (same city, under 15 km) cannot be booked as one-way: the API answers 422 "book an hourly rental package instead", and the rider app and user web redirect to "City Rides", which is the hourly Rental screen. Riders who want an Uber / Ola / Rapido style ride (pick a car or auto, see the fare, go A to B with a few stops) have no mode. The business asked for two modes: **Rental** (hourly package, roam freely) and **City ride** (metered, point to point, up to 3 stops).

## What exists (verified in code)
- A rental is priced from `rental_packages` (package fare + extra per km / minute). Its `rate_cards` row (ride_type `rental`) is used for only three things: it must exist (the quote 422s without it), `stop_charge`, and `cancellation_fee`. Its `rate_per_km`, `rate_per_min`, `min_fare`, `base_fare` are not used for a package rental.
- Stops: max 3 for every ride type (`MAX_STOPS_PER_RIDE`); one-way fares are priced on the detour through the stops. Commission/billing keys off `cities.billing_mode`, not the ride type. Surge keys off city + category.
- Clients never read a rental's rate card; they go through the API. Old driver builds branch on `rideType` (`one_way`, `round_trip`, `rental`) and would mis-handle an unknown value.
- Rate cards are versioned: never UPDATE, insert a new row and close the old one (`effective_to`).

## Design
1. **Detach first.** Rental stops depending on `rate_cards`: stop charge and cancellation fee move to `rental_packages` and are snapshotted on the ride at booking (as migration 099 did for the package terms). The quote for a rental no longer looks up a rate card.
2. **City ride = a new priced mode on the existing one-way machinery.** A city ride keeps `ride_type = 'one_way'` on the wire (old driver apps handle it correctly as metered with stop detours) and carries a new `trip_mode` (`standard` | `city`) on `rate_cards` and `rides`.
3. **"Rename" = copy and close.** Each current rental card is copied into a city card (same per-km, per-minute, minimum fare, stop charge, cancellation fee; ride_type `one_way`, trip_mode `city`). The rental cards are closed only after the detach is live and verified.
4. **Opt-in, flagged.** The new apps send `trip_mode: 'city'`. Requests without it behave exactly as today, including the 422 for in-city one-way. A system-config flag `city_rides_enabled` (default `false`) gates everything; the trip classifier tells the apps whether to use it.
5. **Contract.** After the minimum rider and web versions are raised, delete the flag and the redirect-to-rental code.

## Decisions (assumed)
- D1: Autos are in (the auto category gets a city card). Bikes are out of scope.
- D2: City prices start as copies of the rental card prices; admin edits them afterwards.
- D3: City limit stays "classified in_city and straight-line under `IN_CITY_MAX_TRIP_DISTANCE_METRES` (15 km)".
- D4: Max 3 stops (existing); stop charge comes from the city card.
- D5: Offer rules treat a city ride as `one_way` (no new offer rule type now).
- D6: In the new apps the hourly mode is renamed "Rental"; "City ride" names the metered mode.

## Non-goals
Bikes, a driver-app label for city rides, a new offers rule type, changes to commission.

## Risks
Old builds (mitigated by opt-in and `ride_type` staying `one_way`); open rentals at deploy (mitigated by backfill + fallback); autos with no city card (the app must show "not available", not crash); cache collisions between standard and city cards (cache key includes trip_mode).
