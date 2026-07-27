# Cash Ride — Ledger / Commission / Dues Mechanics (India)

Source: web research, 2026-07-27. For an implementable Postgres wallet-ledger.

## Money flow
On a cash ride the driver holds the full fare → **driver owes the platform the commission** (sign flips vs digital). Uber normalizes cash + digital into one internal ledger; collected cash shows as a **negative payout** and is **netted from next digital earnings**. Rapido/Ola: same netting ("convenience fee adjusted against amounts due").

Single-account model (what most implement, matches Uber's "negative balance" UX):
```
cash ride     -> balance -= commission        (driver owes)
digital ride  -> balance += fare_net_of_comm   (nets it back)
settlement    -> pay positive; block/collect on negative past threshold
```

## Dues limit / go-online blocking
- Uber: personalized/dynamic ceiling (no public hard number — **don't hardcode; use config**), 2-day window, minimum-payment to reactivate, "Outstanding Payment" card, cash requests declined until cleared.
- Bolt: cash paused at negative limit; **hysteresis** (lower re-enable limit) to stop flapping; card trips still flow.
- inDrive/Onde: hard block — can't accept jobs while credit negative; top up before shift.
- Two industry patterns: **post-paid arrears (Uber)** vs **prepaid wallet float / flat SaaS fee (Ola/Rapido/inDrive)**.

## Double-entry (reference)
Cash ride ₹100, 20% commission → net effect: driver owes ₹20 ("cash collected ledger"). Simplified single-account = debit commission on cash, credit net on digital.

Reconciliation: Uber lets driver **enter actual amount received**; that (not the quote) drives commission. Divergence beyond tolerance → flag for review.

## Commission (India, reported)
Uber/Ola ~20–25% (+ GST/tax); inDrive ~10%; Rapido flat ₹10–15 or SaaS. Same rate cash vs digital — only settlement direction differs. **GST-on-cash** is the hard part (platform never touches the fare) → industry drifting to subscription/SaaS to sidestep it.

## Fraud controls (cheap, high-value)
- Cash dues ceiling caps exposure.
- **GPS-reached-drop vs status-cancelled/not-collected mismatch** flag (we log `gps_tracks` + `ride_stops`).
- Per-driver expected-vs-collected **divergence counter**.
- OTP-gated completion (already have 4-digit end OTP) makes phantom-complete hard.

## Applied to Ocar (existing infra)
- `driver_wallet_ledger` + `driver_wallets.balance` (make signed) — cash = commission debit, negative = dues.
- `goOnline` min-balance gate = the dues gate.
- `fare_snapshots` vs logged amount = reconciliation.
- Fraud signals (GPS mismatch, divergence counter) = **v2, out of scope**.

Key sources: Uber India payments engineering blog + Help pages, Rapido Captain Terms, ClearTax/NALSAR/TaxO (GST), SHIELD/Radar/TrustDecision (fraud).
