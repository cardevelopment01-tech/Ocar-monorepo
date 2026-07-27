# Cash Collection — UX / Screen Research (Uber, Bolt, inDrive, Ola, Rapido)

Source: web research, 2026-07-27. Verification status flagged throughout.

## The screen
- **Action + amount log, not a yes/no.** Uber: at drop-off tap "Collect payment" → screen shows the **exact fare** (incl. tolls/promos/prior balance) → driver logs amount → trip ends.
- Over/underpay allowed, but guidance is "log the standard fare" (tips can't go through app on cash).
- **Change-making is not in-app** — physical between driver and rider.
- Final gesture: amount entry (Uber) and/or swipe-to-complete (secondary source; version/region dependent).

## Branching
- Payment method fixed at request time; shown as a **"Cash" badge on the offer card**. Bolt: cannot change after accept.
- Digital rides: **no collect screen**, auto-marked paid.
- Mixed cash+wallet per ride: **undocumented / unsupported**.

## Business rules
- Cash ride → **commission charged to driver balance** (Uber "negative payout", inDrive/Onde "charge fee from balance", Rapido "convenience fee adjusted against amounts due").
- Negative balance blocks cash trips; **hysteresis** thresholds (Bolt: cut at −300k, re-enable above −99k). Uber: 2-day settle window then temp deactivation.
- Not-collected/dispute → routes to support, not self-serve. (Ola cautionary tale: silent debits = driver anger.)
- Rating-vs-cash ordering: unverified; convention = rating after money settled.

## UX best practices
- **Swipe-to-confirm** for money = mimics handing over cash + friction against accidental confirm; self-evident, no onboarding.
- Large high-contrast amount (sunlight/glance), thumb-reachable bottom control (one-handed), accessible fallback for gesture, minimize steps.

## Design inspiration (Uber, reconstructed — no official screenshots public)
Hierarchy: exact fare owed **dominant** → amount-log field → confirm/complete. Ola's screen undocumented (not fabricated).

## Applied to Ocar
1. Branch on `payment_channel` set at booking; cash-only screen.
2. Exact fare large + `SwipeToConfirm` (reuse existing component).
3. Accrue commission to `driver_wallet_ledger` on cash.
4. Gate go-online on negative balance (existing min-balance gate).

Key sources: Uber Help (Managing/Understanding Cash Trips, Paying to Uber), Uber US cash-launch blog, Bolt cash-debt guide, Onde driver-balance-management, Rapido Captain Terms.
