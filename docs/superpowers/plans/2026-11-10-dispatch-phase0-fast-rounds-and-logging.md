# Dispatch phase 0: no waiting on empty rounds, and a record of every round

Why: on 10 Nov 2026 a tester's rental rides found nobody in round 1 (radius 2.5 km) and the first offer went out about 25 s late
(round 2). All three rounds are queued at booking at 0 / 25 / 50 s, and an empty round does nothing, so the next one just waits.
Also nothing records who was considered, how far the road distance was, or why nobody was found, so a complaint like "a driver 2 km
away was online and got nothing" cannot be checked.

## What changes

### A. No waiting on an empty round (switch `dispatch_fast_rounds_enabled`, default `false`)
Only for rides on dispatch variant 1 or 2 (the no-resend switch is on), not return-cab matches, and not when the job carries an explicit
radius. When the normal search for a round finds nobody, widen at once instead of waiting for the timer:

- round 1 (exact vehicle category only): first the fallback categories at the same radius, then each wider radius (+1 km steps, up to
  round 3's radius), exact category first then fallback categories;
- round 2: each wider radius up to round 3's radius, fallback categories;
- round 3: nothing to widen.

The first non-empty step is offered as this round's wave. Rounds 2 and 3 still run on their original timers (25 s, 50 s) and a ride
still closes as `no_drivers` only in round 3, so the rider never sees "no drivers" earlier than before.
`ladder.ts` holds the pure step list so it is unit tested without the queue.

### B. A record of every round (switch `dispatch_decision_log_enabled`, default `true`, additive)
- `ride_assignments` new columns: `straight_m` (straight-line distance at offer time), `shown_m` (the distance shown on the card, road
  distance when Google answered), `radius_m` (radius that found the driver), `rank` (1 = nearest), `reach` (`live` | `background` |
  `no_socket`), `fast_step` (0 = normal search, n = nth widening step). Re-offers overwrite the row (unique ride + driver), so the round
  table below is the history.
- New table `dispatch_rounds`: one row per round that did work: ride, round, radius used, widest radius tried, fast step, category ids,
  found, offered, how many were skipped as live / declined / busy-or-offered-before, outcome (`offered` | `empty` | `closed`), and a `diag` json
  of why nobody (or few) were found: drivers online inside the radius, of those paused, other category, stale position (>10 min), not
  standard mode, driver not active. The diag query only runs when fewer than a full wave was found.
- Recording can never break dispatch: every write is wrapped and its failure only logs.

### Not in this change (later)
Sampled position history, road-ETA ranking, acceptance model, head start tuning, retention job for `dispatch_rounds`.

## Safety
Both switches read live (cached 30 s). Off = today's behaviour exactly. Migration 135 is additive only.

## Tests
Unit: ladder steps; processor (switch off = unchanged, round 1 empty finds a wider step, round 3 never widens, return cab and explicit
radius never widen, logging failure does not stop offers). Integration: migration columns and `dispatch_rounds` insert against the local DB.
