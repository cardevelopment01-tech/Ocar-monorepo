# Load Test — Data & Goals Summary

*Prepared for client update — verified against a full local dry-run before touching staging.*

---

## What gets seeded before any traffic test runs

| Data | Count | Notes |
|---|---|---|
| Synthetic rider accounts | 50,000 | Clearly tagged test data, not real users |
| Historical rides | **1,000,000** | Spread across the past 12 months, realistic status/geography/type mix |
| Fare snapshots | 1,000,000 | One per ride — every booking has a priced estimate |
| Ride status history | ~4,280,000 | Full lifecycle trail (requested → accepted → ... → completed/cancelled) |
| Payments | ~720,000 | Only completed rides get a payment — matches real behavior |
| Cancellations | ~180,000 | 18% of rides, spread across realistic cancellation stages |
| Ratings | ~1,116,000 | Rider↔driver ratings on completed rides |
| Real drivers (reused) | ~200 | Actual onboarded drivers — never fabricated |
| Synthetic drivers (top-up) | ~200 | Added only to reach the 400-driver concurrent target — tagged, used only for the live traffic test, never mixed into the historical data above |

**All of the above has already been built and dry-run end-to-end locally** — every number above is from a real, verified run, not a projection. The same scripts point at staging once it's provisioned, unchanged.

---

## What the test is actually trying to answer

Two separate questions, tested separately:

**1. Does the database stay fast once it's holding a year of real-world volume?**
Four specific queries the app actually runs under load — admin's ride list, a driver's ride history, creating a new ride, and matching a rider to the nearest driver — are timed *before* and *after* the 1,000,000-row seed exists. Pass bar: no more than 20% slower, and never past a hard ceiling.

**2. Does the system hold up under real concurrent traffic?**
400 drivers online simultaneously, 6,000 riders, GPS location updates every 3-5 seconds, continuous booking activity — ramped up in stages (20 → 100 → 250 → 400 drivers), never jumped straight to peak, so any weak point shows up early and small rather than all at once at the top. A separate spike test (instant surge, then recovery) runs afterward.

**Pass criteria for both:** 95th-percentile response time under 500ms, error rate under 1%, and a data-correctness check after every session confirming nothing was left stuck, no payment record is inconsistent, and no driver was ever assigned a ride they weren't actually offered.

---

## Where things stand right now

- Production database backup: **done** (snapshot taken, in progress).
- Seed scripts + traffic-generation (k6) test: **built and verified**.
- Staging environment: next in line to provision.
- Live test session: scheduled once staging is confirmed ready and this plan has your sign-off.

Nothing here is guesswork — every figure above came out of an actual run, and the same process repeats unchanged on staging.
