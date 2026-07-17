# Driver Daily Selfie + Plate Verification — Design Spec

**Date:** 2026-07-17
**Status:** Approved
**Author:** Claude (with Sujal Kumar Ghosh)

## Problem

Client requirement: each operating day, before a driver can go online for the first time, they must submit a selfie (confirms the right driver is operating — anti account-sharing) and a photo of their vehicle's number plate (confirms the right vehicle is in use). Once submitted for the day, the driver can toggle online/offline freely for the rest of that day without repeating the check.

The enum vocabulary for this already exists but is completely unused: `verification_kind` (`daily_selfie`, `daily_plate`) and `verification_status` (`pending`, `passed`, `failed`, `auto_passed`), defined in `api/src/db/migrations/002_enums.sql` and mirrored in `api/src/constants/enums.ts`. `drivers.reference_selfie_url` (captured at registration) and `driver_vehicles.number_plate` both already carry design notes referencing this feature. No table, repository, service, route, or frontend code implementing it exists anywhere — this is new work built against pre-existing but dormant schema pieces.

## Goals

1. New `driver_verifications` table (schema below, provided as the canonical design).
2. A driver cannot go online unless today's selfie + plate check has both rows present and passed for that day.
3. Driver app: capture flow (selfie, then plate) that runs before the existing go-online flow when today's check is incomplete.
4. Backend: one endpoint to submit both photos together; one lightweight endpoint to check today's status.

## Non-goals

- No ML/automated face-match or plate-OCR verification in this pass. The schema's commented-out `confidence` column and `pending`/`failed` statuses are forward-compatible with adding this later, but nothing here builds it.
- No admin review/override UI or endpoint in this pass. The `override_by`/`override_note`/`overridden_at` columns exist in the schema (matching the canonical design) but stay unused until there's an automated check (or manual spot-review process) that actually produces a `failed` status worth overriding.
- No handling of a driver operating more than one vehicle in parallel within a day, or switching primary vehicles mid-day. The plate check is tied to the driver's current primary vehicle at submission time, matching how the existing go-online flow (`StandardConfirm.tsx`) already resolves the driver's vehicle via `getMyVehicle()`.

## Data model

```sql
CREATE TABLE driver_verifications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id      BIGINT NOT NULL REFERENCES drivers(id),
  vehicle_id     BIGINT NULL REFERENCES driver_vehicles(id),
  kind           verification_kind NOT NULL,
  verified_for   DATE NOT NULL,
  image_url      TEXT NOT NULL,
  status         verification_status NOT NULL DEFAULT 'pending',
  override_by    BIGINT NULL REFERENCES admins(id),
  override_note  TEXT NULL,
  overridden_at  TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind != 'daily_plate' OR vehicle_id IS NOT NULL)
);

CREATE UNIQUE INDEX driver_verif_selfie_daily_uniq
  ON driver_verifications (driver_id, verified_for) WHERE kind = 'daily_selfie';

CREATE UNIQUE INDEX driver_verif_plate_daily_uniq
  ON driver_verifications (vehicle_id, verified_for) WHERE kind = 'daily_plate';

CREATE INDEX driver_verif_today_idx
  ON driver_verifications (driver_id, verified_for, kind) WHERE status IN ('passed', 'auto_passed');

CREATE INDEX driver_verif_pending_idx
  ON driver_verifications (created_at) WHERE status = 'pending';
```

`verified_for` is the IST calendar date. `vehicle_id` is NULL for `daily_selfie` rows (uniqueness scoped to driver+day) and required for `daily_plate` rows (uniqueness scoped to vehicle+day — not driver+day, since the canonical design ties the plate check to the specific vehicle photographed).

## MVP verification behavior

No ML/OCR service exists. The submission endpoint inserts both rows directly with `status = 'auto_passed'` (not left as the column's `pending` default) — there's nothing to hold a row pending for yet. `pending`/`failed` and the override columns remain in the schema, unused, ready for when automated verification is added later without requiring a migration.

## Backend

**Gate at the existing choke point.** `api/src/modules/rides/rides.service.ts`'s `goOnline(driverId, data)` is the single function every go-online request already passes through. Before creating the session, check whether today's verification is complete:

```sql
SELECT kind FROM driver_verifications
WHERE driver_id = $1 AND verified_for = $2 AND status IN ('passed', 'auto_passed')
```

If the result doesn't include both `daily_selfie` and `daily_plate`, throw an error with `httpStatus: 428` and `code: 'DAILY_CHECK_REQUIRED'` instead of creating the session.

**Status-check endpoint** — `GET /api/v1/drivers/daily-verification/status` — returns which of today's two kinds are already complete, so the frontend can decide whether to route through the capture flow before the driver even reaches mode selection.

**Submission endpoint** — `POST /api/v1/drivers/daily-verification` — multipart request carrying both images (selfie + plate) in one call, matching the "one combined flow" decision. Resolves the driver's current primary active vehicle (same lookup pattern as `getMyVehicle()`) for the plate row's `vehicle_id`. Reuses the existing `uploadFile()` S3 helper (folder `drivers/{driverId}/daily-verification/{verifiedFor}/`) and the existing multer + image-compression pattern from onboarding document uploads. Inserts both rows in one transaction, each `auto_passed`.

## Frontend (driver app)

Tapping "Go Online" on `Home.tsx` first calls the status endpoint. If either kind is missing for today, navigate to a new capture screen instead of the existing `/go-online/mode` route:
1. Selfie capture — reuses the existing `ReferenceSelfie.tsx` capture-and-compress pattern (raw `getUserMedia` + canvas downscale + JPEG compression).
2. Plate capture — same capture pattern, rear camera preferred, no face-detection framing (just the standard camera capture UI).
3. Submit both together to the new submission endpoint.
4. On success, continue into the existing `/go-online/mode` → `StandardConfirm`/`ReturnCabSetup` flow unchanged.

If today's check is already complete, tapping "Go Online" proceeds straight to the existing flow with no change in behavior.

## Testing

The one piece of non-trivial logic worth a runnable check: the "is today's verification complete" query logic and the IST-calendar-date computation (a date computed incorrectly near midnight would wrongly block or wrongly allow a driver). Extract the calendar-date computation into a small pure function and unit test it against a UTC timestamp that falls on different IST calendar days (e.g. a timestamp that is one IST-day but a different UTC-day, verifying the IST conversion, not UTC, is used).
