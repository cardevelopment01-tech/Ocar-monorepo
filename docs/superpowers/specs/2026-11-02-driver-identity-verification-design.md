# Driver identity verification (daily + random spot checks) — design

Status: approved by owner 2026-11-02 (long-day trigger = hours online, my default, left unanswered) · pending eng review · Owner: Sujal

## 1. Intent

Drivers share accounts: the registered driver lets someone else drive on their login. The daily selfie and
plate check is meant to stop that, but today it verifies nothing. `driver-verification.service.ts` stores
any uploaded image as `auto_passed` (migration 046 says so: "MVP: no ML/OCR service exists yet").

This work makes the check real. A server-side face match compares each selfie to the driver's onboarding
selfie, a plate read compares the photo to the registered plate, and the server asks for extra random
"spot" checks during the day (client request: after 2-3 rides, or after a long day of driving).

## 2. Goals, non-goals, anti-goals

Goals
- G1. Detect a different person submitting the daily or spot selfie (face match vs. the onboarding selfie).
- G2. Detect a plate photo that does not show the registered vehicle's plate (secondary control).
- G3. Server-decided random spot checks, unpredictable to the app and the driver.
- G4. Rollout modes `off | shadow | flag | block` in `system_config`, no deploy to change them.
- G5. Admin review queue sized to what admins can handle (20-30 cases/day; ~300 drivers now, ~1,000 in a
  few months). Clear passes never reach a person.
- G6. Onboarding selfies must themselves be usable faces, since they are the reference everything matches to.

Non-goals (first release)
- Liveness / anti-spoofing (photo or screen replay). Sketched in section 13 as phase 2.
- Rider "this is not the person in the photo" report.
- Finding the same face across two driver accounts.
- Replacing the existing document verification.

Anti-goals (would make this a failure even if it technically works)
- Blocking honest drivers because of lighting, glasses, a beard, or an AWS outage.
- Any new vendor, new infrastructure tier, or ML model that must be hosted by us.
- The client app deciding pass/fail. The server decides; the app only captures and displays.
- Biometric images or scores leaking to rider apps or logs.

## 3. Research summary (what the design is based on)

Sources are listed in section 16. Findings that shaped the design:

1. **Rekognition CompareFaces** returns only target faces whose similarity is at or above
   `SimilarityThreshold` (default 80); faces below it come back as `UnmatchedFaces` with no score. To
   record a score for borderline cases the call must use a low threshold (we use the review floor) and the
   decision bands are applied in our code.
2. **DetectFaces** returns `BoundingBox, Confidence, Landmarks, Pose, Quality` by default (Quality =
   Brightness and Sharpness, 0-100). `EyesOpen`, `Sunglasses`, `Eyeglasses` need `Attributes` requested.
   CompareFaces does not tell you the target had two faces in frame, so a DetectFaces gate (exactly one
   face, usable quality) runs first.
3. **AWS guidance** for false rejections is to compare against several source images; the design keeps up
   to 3 references per driver.
4. **DetectText** returns `LINE` and `WORD` entries with a confidence; `MinConfidence` defaults to 80.
5. **Free tier**: the pricing page lists 1,000 images/month per API group for 12 months from account
   creation; assume none left. Paid cost is about $0.001 per image (third-party listings; confirm the
   Mumbai rate on the AWS page before launch).
6. **Region**: the API's `S3_REGION` and `AWS_REGION` default to `ap-south-1`, so images stay in-region for
   Rekognition (Rekognition must be called in the same region as the bucket for `S3Object` input).
7. **Face Liveness** is listed for Mumbai on the AWS product page, with older sources disagreeing. It is
   phase 2, so it is not a blocker.
8. **ML Kit on the phone was evaluated and dropped**: it cannot match faces, can be bypassed by a modified
   app, and compatibility with Expo 57 / RN 0.86 could not be confirmed.
9. **Best practices applied**: shadow mode before enforcement; thresholds calibrated on local data;
   impostor-score estimation from cross-driver pairs (section 12); fail-open on provider outage with
   review fallback; store scores and the thresholds used, not just the verdict; human review for the
   uncertain band only; reference quality control.

## 4. Current state (verified in code)

- Daily check: `POST /drivers/verification/upload-url` then `POST /drivers/verification/submit`
  (`driver-verification.{controller,service,repository}.ts`). Uploads go to
  `uploads/pending/drivers/{id}/daily-verification/{selfie|plate}/{uuid}`, then `promotePendingUpload`.
- Table `driver_verifications` (046): kinds `daily_selfie`, `daily_plate`; status enum
  `pending | passed | failed | auto_passed`; override columns exist but are unused; unique indexes: one
  selfie per driver per IST day, one plate per vehicle per IST day.
- Gate: `goOnline` (`rides.service.ts` ~L150) throws `DAILY_CHECK_REQUIRED` (428) unless
  `getTodayStatus` shows selfie and plate with status `passed`/`auto_passed`.
- Reference photo: `drivers.reference_selfie_url` (written by `drivers.repository.ts` ~L271, also shown to
  riders as the driver photo, `rides.repository.ts` ~L687).
- Offer eligibility already excludes drivers with a document issue via `docIssueExistsSql(...)` in
  `rides.repository.ts` (~L203 nearby search, ~L296 return-cab search). The same place can exclude
  drivers with an overdue spot check.
- Completion paths in `rides.service.ts`: end-OTP completion (~L2503), `endRideEarlyAsDriver` (~L1996),
  `forceResolveRide` (~L2037, admin/timeout). Each already fires post-completion work such as
  `settleRideCompletionPayment`.
- Config: `getConfigValue(key, fallback)` over `system_config`, cached; numeric bounds live in
  `lib/system-config-bounds.ts`; boolean-like keys in `ALLOWED_VALUES`. Admin edits go through
  `admin/system-config.routes.ts`.
- Notifications: `notifyOwner()` persists a feed row, pushes, and emits the socket event; templates live
  in `notification_templates` (migration 036 pattern).
- Migrations: `origin/main` is at 118. The local branch has an untracked `116_app_update_policy.sql` that
  collides with main's 116, so this work branches from `origin/main` and takes the next free number at
  implementation time (shown below as `NNN`).

## 5. Architecture overview

```
 driver app                      API                                   AWS
 ─────────                       ───                                   ───
 selfie/plate photo ─upload─►  S3 pending key
 POST submit ───────────────►  verification.service.submit
                                 ├─ promote upload to final key
                                 ├─ verification.scorer ───────────►  Rekognition (DetectFaces,
                                 │     (pure decide() + provider)       CompareFaces, DetectText)
                                 ├─ write row: scores + decision + mode
                                 └─ respond {complete, outcome}

 ride completes ─► onRideCompleted ─► spot-check.engine.maybeOpen(driver)
                                         ├─ insert verification_challenges (1 open per driver)
                                         └─ notifyOwner + socket 'verification:required'

 go-online / resume ─► gate: daily check done AND no open spot challenge
 ride offers        ─► SQL predicate excludes drivers with an overdue open challenge

 admin portal ─► /admin/verifications (queue, resolve)  ──► confirmed photos can become references
```

Units (each with one job):
- `verification.provider.ts` — thin Rekognition wrapper (3 calls, timeout, no business rules).
- `verification.decision.ts` — pure functions: face decision, plate decision, mode policy. No I/O.
- `verification.scorer.ts` — orchestrates provider + decision for one submission, returns a scored result.
- `verification.service.ts` — existing; submit flows call the scorer and persist.
- `spot-check.engine.ts` — decides when to open a challenge; persists it; notifies.
- `verification.admin.*` — review queue endpoints.
- Config module `verification.config.ts` — reads and validates all `system_config` keys in one place.

## 6. Data model

All DDL in one new migration (`NNN_driver_identity_verification.sql`) plus one separate tiny migration for
the enum value (`ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that uses the value;
migrations 025/031/047 show the repo's pattern).

```sql
-- NNN-1: enum only
ALTER TYPE verification_kind ADD VALUE IF NOT EXISTS 'spot_selfie';

-- NNN: columns, tables, indexes
ALTER TABLE driver_verifications
  ADD COLUMN match_similarity numeric(5,2),          -- best similarity vs references, null if not scored
  ADD COLUMN face_quality     jsonb,                 -- {brightness, sharpness, pitch, yaw, roll, faces}
  ADD COLUMN ocr_text         text,                  -- normalised plate candidate (plate rows)
  ADD COLUMN ocr_confidence   numeric(5,2),
  ADD COLUMN decision         text CHECK (decision IN ('pass','review','fail','retake','error','skipped')),
  ADD COLUMN decision_reason  text,                  -- machine code, e.g. 'LOW_SIMILARITY'
  ADD COLUMN mode             text CHECK (mode IN ('shadow','flag','block')),
  ADD COLUMN thresholds       jsonb,                 -- thresholds in force when scored (for audit/tuning)
  ADD COLUMN review_state     text NOT NULL DEFAULT 'none'
                               CHECK (review_state IN ('none','queued','confirmed_ok','confirmed_mismatch')),
  ADD COLUMN review_priority  smallint NOT NULL DEFAULT 0,   -- higher = look first
  ADD COLUMN challenge_id     bigint,                -- FK below, null for daily rows
  ADD COLUMN reviewed_by      bigint REFERENCES admins(id),
  ADD COLUMN reviewed_at      timestamptz;
-- existing override_* columns stay as the audit trail for admin overrides

CREATE INDEX driver_verif_review_queue_idx
  ON driver_verifications (review_priority DESC, created_at)
  WHERE review_state = 'queued';                     -- enum-style equality predicate (IMMUTABLE)

CREATE TABLE verification_challenges (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id    bigint NOT NULL REFERENCES drivers(id),
  reason       text NOT NULL CHECK (reason IN ('rides','long_day','random','admin')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','satisfied','expired','waived')),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  due_by       timestamptz NOT NULL,                  -- grace deadline; after this offers are withheld
  attempts     smallint NOT NULL DEFAULT 0,
  satisfied_at timestamptz,
  trigger_data jsonb                                  -- {rides, minutes, target, ride_id}
);
CREATE UNIQUE INDEX verification_challenges_one_open
  ON verification_challenges (driver_id) WHERE status = 'open';

ALTER TABLE driver_verifications
  ADD CONSTRAINT driver_verif_challenge_fk FOREIGN KEY (challenge_id) REFERENCES verification_challenges(id);

CREATE TABLE driver_spot_check_state (                -- the random target, persisted so app restarts / retries can't reroll it
  driver_id    bigint PRIMARY KEY REFERENCES drivers(id),
  rides_target smallint NOT NULL,
  drawn_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_face_references (                 -- up to 3 per driver; the onboarding selfie is #0
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id  bigint NOT NULL REFERENCES drivers(id),
  image_url  text NOT NULL,
  source     text NOT NULL CHECK (source IN ('onboarding','admin_confirmed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_face_refs_driver_idx ON driver_face_references (driver_id, created_at);

ALTER TABLE drivers
  ADD COLUMN reference_quality text CHECK (reference_quality IN ('ok','poor','unchecked')) NOT NULL DEFAULT 'unchecked';
```

Notes
- `status` keeps its existing meaning for the gate (`getTodayStatus` counts `passed` and `auto_passed`).
  `decision` and `review_state` carry the new information, so nothing that reads `status` changes.
- The daily unique indexes are partial on `kind IN ('daily_selfie','daily_plate')`, so `spot_selfie` rows
  are not constrained to one per day. A challenge allows up to `attempts_max` rows.
- Reference images are never auto-added: only an admin "confirmed ok" can promote a spot photo to a
  reference (stops a successful impostor photo from poisoning the reference set). Max 3; the newest
  admin-confirmed replaces the oldest, never the onboarding one.
- Photos older than the retention window are deleted by a cleanup job (section 11).

## 7. Config (`system_config` keys, all validated in `system-config-bounds.ts`)

| Key | Default | Meaning |
|---|---|---|
| `verification_mode` | `off` | `off | shadow | flag | block` (add to `ALLOWED_VALUES`) |
| `verification_face_pass_min` | `90` | similarity at/above = pass (starting value, tune in shadow) |
| `verification_face_review_min` | `75` | between review_min and pass_min = review; below = fail (starting value) |
| `verification_plate_max_edits` | `1` | edit distance to count as a plate match (fail above `plate_review_edits`) |
| `verification_plate_review_edits` | `2` | edit distance still routed to review |
| `verification_min_brightness` / `_sharpness` | `35` / `35` | quality floor for a usable photo (tune in shadow) |
| `verification_retake_max` | `3` | retakes per submission before it routes to review |
| `spot_check_enabled` | `false` | master switch for spot checks |
| `spot_check_rides_min` / `_max` | `2` / `3` | random target range, drawn per driver after each check |
| `spot_check_long_ride_km` | `60` | a completed one-way/round-trip ride at or above this distance forces a re-check (owner chose a distance/duration rule, D3) |
| `spot_check_long_ride_minutes` | `90` | same, by ride duration (either limit triggers) |
| `verification_review_daily_budget` | `30` | admin capacity; used for the backlog alert, not to drop cases |
| `verification_fail_open` | `true` | on provider error: let through and queue for review |
| `verification_retention_days` | `90` | delete photos/scores after this |

All values are my starting guesses except `spot_check_rides_min/max` (client: after 2-3 rides). Face and
quality thresholds are calibrated during shadow mode (section 12) before `flag`.

## 8. Decision logic

### 8.1 Face decision (pure)

```ts
type FaceInput = {
  faceCount: number                         // from DetectFaces on the target
  quality?: { brightness: number; sharpness: number; yaw: number; pitch: number }
  bestSimilarity: number | null             // max over references; null = no match >= floor / not compared
}
type Decision = { decision: 'pass'|'review'|'fail'|'retake'; reason: string }

export function decideFace(i: FaceInput, t: Thresholds): Decision {
  if (i.faceCount === 0) return { decision: 'retake', reason: 'NO_FACE' }
  if (i.faceCount > 1)  return { decision: 'retake', reason: 'MULTIPLE_FACES' }
  const q = i.quality!
  if (q.brightness < t.minBrightness || q.sharpness < t.minSharpness)
    return { decision: 'retake', reason: 'POOR_QUALITY' }
  if (Math.abs(q.yaw) > 35 || Math.abs(q.pitch) > 30)
    return { decision: 'retake', reason: 'FACE_ANGLE' }
  const s = i.bestSimilarity ?? 0
  if (s >= t.facePassMin)   return { decision: 'pass',   reason: 'MATCH' }
  if (s >= t.faceReviewMin) return { decision: 'review', reason: 'BORDERLINE_MATCH' }
  return { decision: 'fail', reason: 'LOW_SIMILARITY' }
}
```

Scorer procedure for one selfie (cost-aware cascade):
1. `DetectFaces(image, Attributes: DEFAULT)` — gate on count and quality. Retake outcomes stop here.
2. `CompareFaces(source = reference #0, target = new photo, SimilarityThreshold = faceReviewMin - 10)`.
3. If the best similarity lands in the review band and the driver has more references, compare against the
   others and keep the maximum (extra calls only for uncertain cases).
4. `decideFace`. No match returned at all means similarity null, so `fail`.

The reference itself is checked the same way at onboarding (section 9.4): `DetectFaces` only, retake until
it passes the quality gate.

### 8.2 Plate decision (pure)

```ts
const CONFUSABLE: Record<string, string> = { O:'0', Q:'0', D:'0', I:'1', L:'1', B:'8', S:'5', Z:'2' }
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const fold = (s: string) => [...s].map(c => CONFUSABLE[c] ?? c).join('')

// candidates: plate-shaped substrings out of all detected LINE texts joined; BH series included
const PLATE_RE = /[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2}/g

export function decidePlate(lines: {text:string; confidence:number}[], registered: string, t: Thresholds): Decision & { text: string|null } {
  const joined = norm(lines.map(l => l.text).join(''))
  const cands = joined.match(PLATE_RE) ?? []
  if (cands.length === 0) return { decision: 'retake', reason: 'NO_PLATE_TEXT', text: null }
  const target = fold(norm(registered))
  const best = cands.map(c => ({ c, d: levenshtein(fold(c), target) })).sort((a,b) => a.d - b.d)[0]!
  if (best.d <= t.plateMaxEdits)    return { decision: 'pass',   reason: 'PLATE_MATCH',      text: best.c }
  if (best.d <= t.plateReviewEdits) return { decision: 'review', reason: 'PLATE_NEAR_MATCH', text: best.c }
  return { decision: 'fail', reason: 'PLATE_MISMATCH', text: best.c }
}
```

`levenshtein` is a ten-line helper (no new dependency). Comparing after folding confusable characters
removes the common O/0, I/1 OCR errors.

### 8.3 Mode policy (pure): what a decision does to the row

| decision | shadow | flag | block |
|---|---|---|---|
| pass | status `auto_passed`, no review | status `passed` | status `passed` |
| review | `auto_passed`, no review | `auto_passed`, `review_state=queued`, priority 1 | same as flag |
| fail | `auto_passed`, no review | `auto_passed`, `queued`, priority 2 | status `failed` (not counted by the gate; driver may retake up to `retake_max`, then it stays blocked until an admin resolves it), `queued`, priority 2 |
| retake | no row; app asked to retake | same | same (after `retake_max`, becomes `review`) |
| error | `auto_passed` | `auto_passed`, `queued`, priority 0 (if `fail_open`) | same as flag; if `fail_open=false`, status `pending` and the driver waits |
| skipped | `auto_passed` | `auto_passed` | `auto_passed` |

In `off` mode nothing is scored and behaviour is exactly today's.

The plate decision sets the plate row; the selfie decision sets the selfie row. Selfie `fail` is the
account-sharing signal; plate `fail` is secondary and never blocks in `block` mode by itself (it
routes to review), because plate OCR is the least reliable part. This is my call, flagged in section 15.

## 9. Flows

### 9.1 Daily check (extends the existing submit)

`submit(driverId, {selfieKey, plateKey})`:
1. Validate keys belong to the driver (existing).
2. Load vehicle (existing); load `verification config` once.
3. Promote uploads (existing).
4. If mode is `off`: insert as today and return.
5. Else score selfie and plate in parallel with a 4 s overall timeout (`Promise.race`); any provider
   error becomes `decision='error'`.
6. Apply the mode policy; insert rows in one transaction with `ON CONFLICT DO NOTHING` (existing
   idempotency for retried submits; a conflicting retry returns the stored outcome and does not re-score).
7. Respond `201 { complete: true, outcome: 'ok' | 'queued' }` or `422 { code: 'VERIFICATION_RETAKE',
   reason: 'NO_FACE' | 'POOR_QUALITY' | ... }`. A blocked selfie in `block` mode returns
   `422 { code: 'VERIFICATION_FAILED' }` with a message that says to retake, not why it failed.

The response never includes scores. `reason` codes are limited to the retake set (these tell the driver how
to fix the photo, not how to game the match).

### 9.2 Spot check (random re-check)

Trigger — runs after a ride completes, from one shared hook called by the end-OTP path and
`endRideEarlyAsDriver` (not `forceResolveRide`, since admin/timeouts say nothing about the driver being present):

```ts
export async function maybeOpenSpotCheck(driverId: bigint, rideId: bigint): Promise<void> {
  const cfg = await loadVerificationConfig()
  if (cfg.mode === 'off' || !cfg.spotEnabled) return
  if (await hasOpenChallenge(driverId)) return

  const since = await lastVerifiedAt(driverId)            // newest passed/auto_passed daily or spot selfie
  const { rides, minutes } = await completedSince(driverId, since)   // uses the (driver_id, completed_at) index
  const target = await getOrDrawRidesTarget(driverId, cfg.ridesMin, cfg.ridesMax)  // persisted, crypto.randomInt

  let reason: 'rides' | 'long_day' | 'random' | null = null
  if (rides >= target) reason = 'rides'
  else if (minutes >= cfg.longDayMinutes) reason = 'long_day'
  else if (randomInt(0, 100) < cfg.randomPct) reason = 'random'
  if (!reason) return

  // unique partial index = at most one open challenge per driver even under concurrent completions
  const ch = await insertChallengeIfNoneOpen(driverId, reason, dueBy(cfg.graceMinutes), { rides, minutes, target, rideId })
  if (!ch) return
  await redrawTarget(driverId, cfg)                      // next target for after this check
  void notifyOwner(/* push + feed + socket 'verification:required' with {challengeId, dueBy} */).catch(log)
}
```

The call is `void maybeOpenSpotCheck(...).catch(log)` inside the completion path, so a failure here can
never affect fare settlement or the ride result.

Driver response: the app shows a full-screen selfie capture (reuses the daily capture component). It calls
`POST /drivers/verification/spot/:challengeId/upload-url` then `POST .../submit {selfie_key}`. The submit
runs the same selfie scorer and mode policy, increments `attempts`, and on a non-`retake` result marks the
challenge `satisfied` (in `block` mode a `fail` leaves the challenge `open` until retakes run out, then it
stays blocked pending admin resolution).

### 9.3 Enforcement points

- **go online / resume**: after the daily check, `getOpenChallenge(driverId)`; if open, throw
  `428 SPOT_CHECK_REQUIRED` with `{challengeId, dueBy}`. The app maps it to the capture screen.
- **ride offers**: next to `docIssueExistsSql(...)` (rides.repository ~L203, ~L296) add a predicate
  `NOT ${spotCheckOverdueSql('ds.driver_id')}`, expressed as `NOT EXISTS (SELECT 1 FROM
  verification_challenges vc WHERE vc.driver_id = ... AND vc.status = 'open' AND vc.due_by < now())`.
  Offers are withheld only after the grace deadline. Rides already accepted or in progress are never touched
  (same rule as `canTakeWork`: block new work, never strand a passenger).
- **expiry**: a scheduler job marks challenges open for more than 24 h `expired` and sets
  `review_state` on nothing; the driver still has to complete a fresh daily check next time. (The job
  also raises a metric so ops can see ignored challenges.)

### 9.4 Reference photo quality (G6)

- On onboarding selfie save, run `DetectFaces`; reject with a retake reason unless exactly one face of
  usable quality, frontal, eyes open (request `EYES_OPEN`), no sunglasses (`SUNGLASSES`). Set
  `reference_quality='ok'` and insert `driver_face_references` source `onboarding`.
- **Backfill** (one-off script, read-only against Rekognition): score existing `reference_selfie_url`s.
  Drivers whose reference is `poor` get `reference_quality='poor'`; the next daily check asks them to
  retake the reference selfie first (the new one then goes through the admin queue once as `confirmed_ok`
  before it replaces the reference). Until resolved, their selfie comparisons are not enforced (decision
  `skipped`), so a bad reference never blocks an honest driver.

### 9.5 REVISION 2026-11-02 (owner, Uber-style) — supersedes 9.2, 9.3 and the spot-check parts of 15b

Owner clarification: after a random 2-3 rides, or after a long ride (one-way or round trip), the driver is
taken **offline** and must verify **selfie and plate** to go online again. Decisions D2/D3 (eng review).

- **Trigger (at ride completion, end-OTP and `endRideEarlyAsDriver`; not `forceResolveRide`):**
  `ridesSinceLastVerifiedCheck >= target` (random 2-3, persisted in `driver_spot_check_state`, redrawn
  after each check), OR the completed ride is `one_way`/`round_trip` with `actual_distance_km >=
  spot_check_long_ride_km` or `actual_duration_min >= spot_check_long_ride_minutes`.
- **Action:** in one place after completion: insert the open `verification_challenges` row (reason
  `rides` | `long_ride`; the unique partial index keeps one open per driver), **end the driver's online
  session** through the same code path as going offline, and push "Verify to go online".
- **No grace window, no offer-withholding SQL, no scheduler job, no `random_pct`:** an offline driver gets
  no offers. Removed: `spot_check_grace_minutes`, `spot_check_random_pct`, `spot_check_long_day_minutes`,
  the expiry job, the 10-minute scheduler pass (D2 = defer). The "online but idle" case is out of scope.
- **Satisfying it:** the driver opens the normal verification screen (selfie + plate) and submits with the
  `challenge_id`. Because a daily row already exists today, these rows use new kinds `spot_selfie` and
  `spot_plate` (add both enum values in the enum-only migration); they have no per-day unique index, so
  retakes insert new rows. The same scorer, mode policy and review queue apply. A non-retake result marks
  the challenge `satisfied`; in block mode a selfie `fail` leaves it open until retakes run out, then it
  stays open until an admin resolves or waives it.
- **Gate:** `goOnline` and `resume` return `428 SPOT_CHECK_REQUIRED` while a challenge is open (after the
  daily-check gate). Nothing else gates offers.
- **App change:** go-online error `SPOT_CHECK_REQUIRED` opens the existing verification screen in "re-verify"
  mode; no separate spot-check screens or socket event are needed.
- **Never mid-ride:** the trigger runs only after a ride is completed, so no passenger is stranded.

## 10. Admin review

API (admin-authenticated, `super_admin` and `ops_admin`):
- `GET /api/v1/admin/verifications?state=queued&cursor=` — queue ordered by `review_priority DESC,
  created_at`; returns presigned URLs for the new photo and the reference(s), `decision_reason`, and the
  similarity (admins see scores; drivers never do).
- `GET /api/v1/admin/verifications/:id` — one case plus the driver's last 10 verification outcomes.
- `POST /api/v1/admin/verifications/:id/resolve { outcome: 'ok' | 'mismatch', note, add_reference?: boolean }`:
  - `ok`: `review_state=confirmed_ok`; if the row was `failed`, set `status='passed'` and fill the
    `override_*` columns; optionally add the photo as a reference (max 3).
  - `mismatch`: `review_state=confirmed_mismatch`, `status='failed'`; recorded in the audit log
    (`system_config.routes.ts` shows the audit pattern), and the admin can then use the existing driver
    suspend flow. No automatic suspension in the first release.
- `GET /api/v1/admin/verifications/stats` — queued now, queued today vs. `review_daily_budget`, decision
  histogram by day (feeds the calibration view and the backlog alert).

Admin portal: a "Verifications" page (queue list + side-by-side image view with approve / mismatch buttons)
and a small verification history block on the driver detail page. UI follows the existing admin pages.

## 11. Security, privacy, operations

- **Auth**: all new driver routes use `authenticate()` + `onlyDriver`; the admin routes use the existing
  admin middleware. Upload keys are validated to belong to the driver and challenge (existing pattern).
- **No error leakage**: provider errors are logged, never returned (`error.message` rule).
- **Scores stay server-side**: not in driver or rider responses, not in logs (log decision and reason only).
- **IAM**: the Rekognition client needs `rekognition:DetectFaces`, `CompareFaces`, `DetectText` and S3 read on
  the bucket when called with `S3Object`. Which credential it uses (the instance role vs. the static
  `S3_ACCESS_KEY` pair) is an open item (section 15). Any Terraform change follows
  `docs/INFRA_ENVIRONMENTS.md`: never applied to prod state from `infra/terraform`; this needs ops approval.
- **Biometric data / consent**: face images and match scores are sensitive personal data (India DPDP Act
  2023). Needs: consent text at onboarding and on the daily screen, purpose limited to identity checks, a
  retention limit (`verification_retention_days`, cleanup job deletes images and scores), and
  confirmation of AWS's data-use terms for Rekognition (the AWS AI-services opt-out policy for content
  use). I am not a lawyer — the owner should confirm with the client before `flag` mode goes live.
- **Resilience**: provider calls use a 3 s per-call timeout and no automatic retry inside the request;
  failures follow `verification_fail_open`. A circuit breaker is not needed at this volume (about 1,200
  checks/day now); revisit only if error rates are high.
- **Metrics** (prom-client, same registry): `verification_decisions_total{kind,decision,mode}`,
  `verification_provider_latency_seconds`, `verification_provider_errors_total`,
  `verification_review_queue_depth`, `verification_challenges_total{reason,status}`. Alerts (via the
  existing Grafana alert Terraform pattern): provider error rate, queue depth above budget for 2 days,
  challenges ignored.
- **Cost**: roughly 2 API calls per selfie and 1 per plate. At 300 drivers (about 1,200 checks/day) this
  is a few thousand rupees a month; at 1,000 drivers about ₹15-20k at $0.001/call (confirm Mumbai rate).

## 12. Rollout and calibration

Phases (each a single `system_config` change):
1. **Deploy dark**: code and migrations live, `verification_mode=off`.
2. **Shadow (>= 7 days, longer if volume is low)**: score everything, enforce nothing. At the end, review
   the score histogram. Estimate the false-accept side with an offline script: sample ~300 cross-driver
   pairs (driver A's selfie vs. driver B's reference) and record the similarity distribution, so we see how
   high an impostor can score. Set `face_pass_min` above the high end of that impostor distribution and
   `face_review_min` so the review band yields about the admin budget (20-30 cases/day). Also check the
   same-driver score distribution so honest drivers do not fall into the fail band.
3. **Flag (about 2 weeks)**: review/fail rows queue for admins, drivers keep working. Track admin
   decisions: `confirmed_ok` vs. `confirmed_mismatch` rates tell us whether the band is too wide.
4. **Block**: ops flips `verification_mode=block` when the numbers look right. Spot checks can be enabled
   (`spot_check_enabled`) in flag mode or earlier; they only require a response, the outcome policy is
   still the mode.

Rollback is one config change (`off`). Because `status` semantics are unchanged, no data migration is
needed to roll back.

## 13. Phase 2 (not in this release)

- **Liveness**: Rekognition Face Liveness, a short on-camera challenge, checked only where it matters
  (spot checks and flagged drivers). Requires the AWS Amplify liveness component in the app, a server
  session create/get-results API, and confirmed Mumbai availability.
- **Rider mismatch report**: one-tap "driver does not match the photo" on the ride screen, feeding a
  challenge with reason `admin`.
- **One face, two accounts**: a Rekognition face collection with `SearchFacesByImage` at onboarding and on
  confirmed references.

## 14. Testing

- **Unit (pure)**: `decideFace`, `decidePlate`, mode policy table, plate normalisation and confusable
  folding, `levenshtein`, config parsing and bounds. Table-driven; no AWS.
- **Scorer with mocked provider**: each branch (no face, two faces, poor quality, match, borderline, no
  match, provider timeout, provider error).
- **Service integration (real Postgres, mocked provider)**: daily submit in each mode; idempotent retry;
  `failed` row not counted by `getTodayStatus`; retake responses; spot-check submit and challenge
  satisfaction; admin resolve overrides; uniqueness of one open challenge under concurrent completions.
- **Trigger engine**: counter trigger, long-day trigger, random trigger (seeded RNG), no trigger when a
  challenge is open or mode is `off`, and failure in the hook does not fail ride completion.
- **Offer gating**: a driver with an overdue challenge is excluded from both offer queries; one inside the
  grace window is not.
- **Load**: extend `load-tests/k6/edge-flows.js` with the new routes; run the scorer against a stubbed
  provider so the load test does not call AWS (note: prod holds 400 seeded `+918888%` drivers; the
  stub must make seeded drivers skip scoring).
- **Real-image check** (manual, staging): a small fixture set of consented photos, covering same person
  under different lighting, different person, no face, two faces, plate photos incl. dirty/angled plates.

## 15. Open decisions and my calls

My calls (change if wrong):
- A required spot-check response applies in `flag` mode too, otherwise a sharer just ignores the prompt.
- Grace 10 minutes before offers are withheld; never interrupts a ride in progress.
- Plate fail never blocks by itself; it goes to review. Selfie fail is the only blocking signal.
- Long-day = driven minutes (`actual_duration_min` of completed rides) since the last check, default 240.
- Extra 5% random trigger per completed ride on top of the 2-3 ride counter.
- Thresholds (90/75, quality 35/35, plate 1/2 edits) are starting values for shadow mode, not final.
- Failures to score (outage) fail open and queue at the lowest priority.
- Max 3 references per driver, only promoted by admin confirmation.
- No automatic suspension on `confirmed_mismatch` in the first release.

Needs the owner / ops:
- O1. Which AWS credential the API uses for Rekognition (instance role vs. static keys) and the Terraform
  change to grant it, applied through the documented prd/prod process.
- O2. Consent wording, retention period, and the AWS data-use opt-out (legal, before `flag`).
- O3. The Mumbai Rekognition per-image price and Face Liveness availability (before phase 2).
- O4. Who handles drivers whose reference selfie is `poor` (in-app retake and the one-time admin confirm).

### 15b. Builder-check resolutions (my calls, marked for the owner to check)

- **Challenge state machine.** `open` → `satisfied` (a non-retake result is accepted: `passed`, or in
  flag mode `auto_passed`+queued) or `waived` (admin only). There is **no automatic expiry**: an ignored
  challenge stays `open`, offers stay withheld after `due_by`, and go-online/resume are refused, until the
  driver responds or an admin waives it. This closes the "ignore it for 24 h" hole. The earlier expiry
  job is removed; instead the admin stats endpoint lists overdue open challenges. In block mode a `fail`
  leaves the challenge `open` (retakes up to `retake_max`, then admin resolution).
- **Gate while a challenge is open.** `goOnline` and `resume` both refuse with `428 SPOT_CHECK_REQUIRED`
  immediately (a new session is new work). A driver already online keeps the grace window (`due_by`), then
  offers are withheld. Rides already accepted or in progress are never touched.
- **Long-day trigger source.** Engine also runs from the existing scheduler worker every 10 minutes over
  online drivers, so a driver who stays online without completing rides is still evaluated. Default
  definition (pending owner answer, see the question to the owner): minutes online since the last
  verified check, from `driver_sessions`.
- **Reference image source.** `reference_selfie_url` and verification images are virtual-hosted S3 URLs
  written by `uploadFile`/`promotePendingUpload`; the existing `extractS3Key` in `lib/storage.ts` (to be
  exported) turns them into the key for `S3Object`. In dev (`S3_BUCKET_NAME` empty) uploads are
  placeholder URLs, so the scorer returns `skipped`. A reference that is not an S3 URL, or whose object is
  missing (`InvalidS3ObjectException`), is treated as `reference_quality='poor'` → `skipped`.
- **Replacement reference for `poor` references.** `driver_face_references` gets a `status`
  (`active | pending`). The driver's retaken reference is stored `pending`; `reference_selfie_url` (the
  rider-visible photo) is unchanged until an admin confirms it, then the new one becomes `active` and
  `reference_selfie_url` is updated. Until then the driver's selfie comparisons are `skipped`.
  Mid-onboarding with `mode=off` still inserts the `onboarding` reference row.
- **App and admin scope.** The plan covers backend, the driver app (capture screen for spot checks, the
  `VERIFICATION_RETAKE`/`VERIFICATION_FAILED`/`SPOT_CHECK_REQUIRED` mappings, consent text) and the admin
  portal (Verifications page, driver history block). Old app builds would show a generic error, so
  `spot_check_enabled` and `block` mode are enabled only after
  `app_update_driver_android_min` is raised to the release that handles the new codes (existing
  app-update policy). Shadow mode needs no app change.
- **Per-driver override.** `drivers.verification_mode_override text NULL` (`off|shadow|flag|block`) beats
  the global mode. It serves pilots (20 drivers in flag first) and exempts the seeded load-test drivers
  (`+918888%`) with an approved one-time update by ops; no phone prefix is hard-coded in code.
- **Retake counter.** Server-side Redis key `verification:retake:{driverId}:{istDate}:{kind}` with a
  24 h TTL, incremented on each `VERIFICATION_RETAKE`; at `retake_max` the next unusable photo is stored
  as `review`. (Spot-check retakes use `verification_challenges.attempts`.)
- **Retention.** The cleanup job deletes the S3 images of `driver_verifications` older than
  `verification_retention_days` and records `image_deleted_at`; it keeps the row (decision, reason,
  similarity, thresholds) for a year for audit and calibration. Reference images of active drivers are
  never deleted by it.

## 16. Sources

- Rekognition CompareFaces API: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- Rekognition similarity thresholds: https://docs.aws.amazon.com/rekognition/latest/dg/thresholds-collections.html
- Rekognition FaceDetail (Pose, Quality, attributes): https://docs.aws.amazon.com/rekognition/latest/APIReference/API_FaceDetail.html
- Rekognition TextDetection: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_TextDetection.html
- Rekognition pricing and free tier: https://aws.amazon.com/rekognition/pricing/
- Rekognition Face Liveness: https://aws.amazon.com/rekognition/face-liveness/
- Repo: `api/src/modules/drivers/driver-verification.*`, `api/src/db/migrations/046_driver_verifications.sql`,
  `api/src/modules/rides/rides.service.ts`, `api/src/modules/rides/rides.repository.ts`,
  `api/src/lib/system-config*.ts`, `api/src/lib/storage.ts`.

---

# Engineering review (gstack /plan-eng-review, 2026-11-02)

Target: this document (plan/design doc). Scope Challenge result: **scope accepted as-is** (owner kept the
multi-reference table; structure question chose the smaller file arrangement, which preserves scope).

## Decision ledger

| ID | Choice | Answer | Accepted scope |
|----|--------|--------|----------------|
| D1 | Defer multi-reference table? | B) Keep multi-reference | `driver_face_references` stays in release 1 |
| D2 | Defer 10-min scheduler pass? | Owner clarified (Uber style); answer treated as deferral | Scheduler pass, grace window and expiry job removed; see 9.5 |
| D3 | What is a "long ride"? | A) distance/duration limit in `system_config` | `spot_check_long_ride_km` (60) and `_minutes` (90) |
| D4 | Retake storage under daily unique index | A) attempts table + update daily row | New `driver_verification_attempts`; daily row upserted to the latest outcome, never downgrading `passed` |
| D5 | File arrangement | B) smaller arrangement | `verification.decision.ts` (pure) + `verification.provider.ts` (AWS) separate; config loading, scoring orchestration and the spot-check trigger live in `driver-verification.service.ts`; admin routes in one file |

Approval readiness: PASS (D1-D5 each cite the owner's actual answer; the owner's earlier "plan is good" covers the
modes/threshold design in sections 7-8, and the off-mode regression contract in 8.3).

## Reality rows

- premise-table: `reference_selfie_url` exists (migration 019 L5; written at drivers.repository.ts ~L271) = verified.
  Daily unique indexes (046 L25-27, L29-33) = verified. Enum `ADD VALUE` in its own migration (025, 031, 047) and each
  migration runs in its own BEGIN/COMMIT (db/migrate.ts L147-153) = verified. Completion paths rides.service.ts L1996,
  L2503 = verified. `extractS3Key` exists but is not exported (lib/storage.ts L30) = verified. Rekognition per-image
  price for Mumbai and Face Liveness in Mumbai = unverified (third-party sources). `unverified=2`.
- already-done: `git log origin/main --since=2026-10-01` on the verification service/repository shows no hits; no
  Rekognition dependency in `api/package.json`. Not done yet.
- surface-check: routes `/drivers/verification/*` (existing controller) verified; new admin and spot routes are proposals.
- binding-decisions: `gstack-decision-search` returned nothing for this branch.
- numbers: ~1,200 checks/day at 300 drivers [estimated: 300 drivers x (1 daily + ~3 spot)]; $0.001/call [estimated:
  third-party listings, re-measure before launch]; 20-30 reviews/day budget [owner-stated].
- deferred-asks: client asked for random spot checks after 2-3 rides and after long rides: both covered (9.5).
  Plate re-check at spot checks: covered. Liveness, rider report, same-face-two-accounts: deferred by design (13).
- pr-count: recommend 3 PRs (see Parallelization): PR1 dark deploy + shadow scoring; PR2 admin queue; PR3 spot checks +
  gate + app. Each extra PR costs one review/merge/deploy cycle but PR3 can ship only after the driver-app minimum
  version is raised.

REALITY: premise-table finding 2 unverified prices, see above api/src/db/migrations/046_driver_verifications.sql:25
REALITY: already-done pass no prior art on origin/main for the verification files api/src/modules/drivers/driver-verification.service.ts:1
REALITY: surface-check pass existing verification routes verified api/src/modules/drivers/driver-verification.controller.ts:11
REALITY: binding-decisions pass gstack-decision-search returned no binding decisions for this branch, none overruled docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md:1
REALITY: numbers pass estimates tagged above docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md:1
REALITY: deferred-asks pass all client asks covered or deferred docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md:1
REALITY: pr-count pass 3 PRs rationale above docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md:1

## Findings

### Section 1: Architecture

1. [P1] (confidence: 9/10) api/src/db/migrations/046_driver_verifications.sql:25-27 +
   api/src/modules/drivers/driver-verification.repository.ts:42-48 — one `daily_selfie` row per driver per IST day
   and `ON CONFLICT ... DO NOTHING`: in block mode a `failed` row owns the slot, so a retake is silently dropped and
   the driver stays blocked all day. Disposition: **accepted, D4 A** (attempts table + upsert of the daily row).
2. [P2] (confidence: 7/10) design 9.5 — forcing a driver offline after a completed ride must use the existing
   session-end path and must tolerate advance (scheduled) bookings assigned to that driver; unverified in code.
   Disposition: **accepted as a build requirement** (T4); verify against the advance-booking assignment code before PR3.
3. [P2] (confidence: 8/10) design 11 / O1 — the Rekognition IAM grant is a launch blocker and prod Terraform must not
   be applied from `infra/terraform` (CLAUDE.md, docs/INFRA_ENVIRONMENTS.md). Disposition: **accepted** (T1, owner action).
4. [P2] (confidence: 8/10) design 9.1 — the provider call must not run inside a DB transaction or hold a pool
   connection (request pool cap is small; breakpoint test 2026-10-26). Disposition: **accepted**; score first, then open
   the insert transaction (T3).
5. [P3] (confidence: 7/10) design 8.3 — during an AWS outage in `block` mode, fail-open lets everyone through silently
   for the outage duration. Disposition: **accepted as-is**; mitigated by the provider-error alert and the queued
   `error` rows.

### Section 2: Code quality

1. [P3] (confidence: 7/10) design 8.2 — no `levenshtein` helper exists in `api/src` or `packages` (searched); write the
   ~10-line function in `verification.decision.ts`, no new dependency. Disposition: **accepted**.
2. [P3] (confidence: 8/10) design 7 — 15 config keys read per submit: load them with one `Promise.all` over the cached
   `getConfigValue`, validate once, and pass an immutable `Thresholds` object to the pure functions. Disposition: **accepted**.
3. Shared code: no new extraction beyond exporting `extractS3Key` (callers: scorer, backfill script). No diagrams to update.

Dispositions: S1.1 D4 A; S1.2 T4; S1.3 T1; S1.4 T3; S1.5 accepted; S2.1 accepted; S2.2 accepted.

### Section 3: Test review

Existing coverage read: `api/tests/integration/driver-verification.test.ts` covers status, init and submit happy path
(L100-148). Everything else below is a proposed path.

```
CODE PATHS                                              USER FLOWS
[+] verification.decision.ts (new, pure)                [+] Daily check
  ├── decideFace()                                        ├── [★★ TESTED] Complete daily check (off mode) — driver-verification.test.ts:118-148
  │   ├── [GAP] no face / two faces / poor quality        ├── [GAP] Retake after NO_FACE or POOR_QUALITY
  │   ├── [GAP] pass / review / fail bands                ├── [GAP] [→E2E] Block mode: fail, retake, pass (D4 regression)
  │   └── [GAP] angle limits                              └── [GAP] Idempotent retry of submit returns stored outcome
  ├── decidePlate()                                     [+] Spot check (9.5)
  │   ├── [GAP] confusable folding (O/0, I/1)             ├── [GAP] [→E2E] 2-3 rides then offline, verify, online
  │   ├── [GAP] BH series, no plate text                  ├── [GAP] [→E2E] Long ride forces offline
  │   └── [GAP] edit-distance bands                       └── [GAP] go-online refused 428 SPOT_CHECK_REQUIRED
  └── [GAP] mode policy table (shadow/flag/block/off)   [+] Admin review
[+] verification.provider.ts (new)                        ├── [GAP] queue order by priority
  └── [GAP] timeout / provider error / missing S3 obj     ├── [GAP] resolve ok overrides failed row
[+] driver-verification.service.ts (changed)              └── [GAP] resolve mismatch recorded + audited
  ├── submit() [GAP] attempts row + upsert, never        [+] Onboarding reference
  │         downgrading passed                              └── [GAP] poor reference -> skipped, retake flow
  ├── [GAP] provider scoring outside the DB transaction
  └── spot-check trigger [GAP] count / long-ride / hook failure never fails ride completion
[+] migrations [GAP] enum add + columns + indexes apply on a fresh DB (migrate --fresh)

COVERAGE: 1/22 paths tested (5%)  |  Code paths: 0/13 (0%)  |  User flows: 1/9 (11%)
QUALITY: ★★★:0 ★★:1 ★:0  |  GAPS: 21 (4 E2E, 0 eval)
```

Required tests (all derive from the approved contracts; value bar applied):
- **Regression (CRITICAL, approved contract 8.3):** with `verification_mode=off` the existing
  `driver-verification.test.ts` flow and `getTodayStatus`/`goOnline` gate behave exactly as today. Extend that file.
  Value: protects=off mode unchanged for the gate; fails_when=scoring runs or rows change shape in off mode; why_new=existing
  test only runs without a mode setting; seam=none; no_claim=real Rekognition behaviour (mocked provider).
- `verification.decision.test.ts` (table-driven, no AWS): all face/plate/mode rows above. Value: protects=decision bands and mode
  policy; fails_when=a threshold comparison or table row is wrong; why_new=no such code today; seam=none; no_claim=model accuracy.
- Service integration (real Postgres, mocked provider): block-mode fail then retake then pass; failed row never blocks a
  later passed attempt; `passed` is never downgraded; retry idempotency; provider error -> fail-open + queued.
- Trigger engine: count trigger, long-ride trigger (km and minutes), no trigger in `off`, hook exception does not fail
  ride completion, one open challenge under concurrent completions (unique index).
- Gate: open challenge -> 428 on `goOnline` and `resume`; satisfied -> allowed; admin waive -> allowed.
- Admin: queue ordering, resolve ok/mismatch, audit entry.
- k6: extend `load-tests/k6/edge-flows.js` with a stubbed provider; seeded `+918888%` drivers set to override `off`.
- Real-image check (manual, staging, consented photos): same person/different lighting, different person, no face, two
  faces, plate photos.

Tests made obsolete by this plan: none.

Dispositions: all 21 gaps accepted as required proof of the approved contracts (no new policy introduced).

### Section 4: Performance

No issues found at the stated scale. Per completed ride the hook does 4 small indexed reads (open challenge via the
partial unique index, last verified check, rides since via `driver_completed_rides_index` from migration 118 on main,
persisted target) [scale: ~1,200 rides/day, estimated]. Provider latency is bounded by the 3 s per-call and 4 s overall
timeouts. Review queue reads use `driver_verif_review_queue_idx`.

Dispositions: none.

## Outside voice

Codex was configured but unavailable: the Codex endpoint has custom routing and no plan-review model is set
(`gstack-config set model_frontier_openai <model-id>` to fix). The native Claude fallback was not available in this
session (no TaskOutput). **Outside coverage: unavailable.** No clean-review credit is claimed.

## NOT in scope

- Liveness / anti-spoofing: separate server API and app component, after shadow data shows spoofing (section 13).
- Rider "not the same person" report and same-face-two-accounts search: separate features (13).
- "Online but idle" long-day trigger and the 10-minute scheduler job: deferred by D2.
- Automatic suspension on `confirmed_mismatch`: needs an owner policy.
- On-device ML Kit pre-checks: evaluated and dropped.

## What already exists

`system_config` + `getConfigValue` + bounds (`lib/system-config*.ts`); `notifyOwner`; S3 pending upload / promote and
`extractS3Key` (`lib/storage.ts`); the `goOnline` daily-check gate and `DAILY_CHECK_REQUIRED` mapping; override columns
and review index on `driver_verifications`; `driver_completed_rides_index` (migration 118); k6 `edge-flows.js`; the
admin audit pattern in `admin/system-config.routes.ts`; app-version minimum gate (`app_update_driver_android_min`).

## Failure modes

| Path | Realistic failure | Covered? | User sees |
|------|-------------------|----------|-----------|
| Rekognition call | timeout / 5xx | provider-error test; fail-open + queued row + alert | nothing (driver continues) |
| Reference S3 object missing | `InvalidS3ObjectException` | `skipped` decision test | nothing |
| Retake after failed selfie | slot already taken | D4 regression test | clear retake message |
| Completion hook throws | DB blip | hook-isolation test; error log + metric | ride result unaffected; driver not re-verified this time (visible to ops via metric) |
| Push fails after forced offline | FCM down | driver is offline anyway and sees the gate on next go-online | clear 428 message |
| Admin queue overflow | more cases than 20-30/day | stats endpoint + alert | drivers unaffected in flag mode |

Critical gaps: 0.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 IAM + env | infra/terraform | — |
| PR1: migrations, provider, decision, service scoring, attempts table, shadow mode | api/src/db, api/src/modules/drivers, api/src/lib | T1 for live calls (mocked until then) |
| PR2: admin queue API + portal page | api/src/modules/admin, apps/admin | PR1 schema |
| PR3: spot-check trigger, gate, driver-app screens, min-version raise | api/src/modules/rides, apps/driver-mobile, packages/mobile-shared | PR1 |

Lane A: PR1 (shared api/drivers). Lane B: PR2 (admin). Lane C: PR3 (rides + app). Lane D: T1 (infra).
Execution order: launch A + D. After A merges, launch B + C in parallel. Conflict flag: B and C both read the new
tables but touch different modules; coordinate only on the shared `errorMessages.ts` mapping (C owns it).

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — infra — grant Rekognition + S3 read to the API role via the prd/prod process
  - Surfaced by: Architecture 3 — O1 / section 11
  - Files: infra/terraform (prd scripts per docs/INFRA_ENVIRONMENTS.md)
  - Verify: `aws rekognition detect-faces` from the API role against a test object in the bucket
- [ ] **T2 (P1, human: ~1d / CC: ~30min)** — db — migrations: enum values, columns, challenges, attempts, references, state
  - Surfaced by: Architecture 1, D1, D4 — sections 6, 9.5
  - Files: api/src/db/migrations (two files; next free numbers after main's 118)
  - Verify: `cd api && pnpm migrate --fresh` and the migration tests
- [ ] **T3 (P1, human: ~2d / CC: ~1h)** — api — provider + pure decision + scoring in `submit`, outside any transaction
  - Surfaced by: Architecture 4, Code quality 1-2 — sections 5, 8
  - Files: api/src/modules/drivers/verification.decision.ts, verification.provider.ts, driver-verification.service.ts/.repository.ts
  - Verify: decision table tests, service integration tests, the regression test for `off`
- [ ] **T4 (P1, human: ~2d / CC: ~1h)** — api — spot-check trigger on completion, forced offline, `SPOT_CHECK_REQUIRED` gate
  - Surfaced by: Architecture 2 — section 9.5
  - Files: api/src/modules/rides/rides.service.ts, driver-verification.service.ts
  - Verify: trigger and gate tests; advance-booking edge verified before merge
- [ ] **T5 (P2, human: ~2d / CC: ~1h)** — admin — review queue endpoints and portal page
  - Surfaced by: Test review (admin flows) — section 10
  - Files: api/src/modules/admin, apps/admin
  - Verify: integration tests + admin vitest
- [ ] **T6 (P2, human: ~1d / CC: ~40min)** — app — re-verify mode, new error mappings, consent text
  - Surfaced by: Architecture 2 / 9.5 app change
  - Files: apps/driver-mobile, packages/mobile-shared/src/api/errorMessages.ts
  - Verify: unit tests + emulator pass; raise `app_update_driver_android_min` before enabling block/spot checks
- [ ] **T7 (P2, human: ~1d / CC: ~30min)** — ops — shadow-mode calibration script (cross-driver impostor sample) and metrics/alerts
  - Surfaced by: Test review / section 12
  - Files: load-tests/verify or scripts, infra/terraform/observability
  - Verify: histogram output reviewed before moving to `flag`

## Unresolved decisions

None in this review. Open owner items remain: O1-O4 (section 15).

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 2 unverified premises
- Architecture Review: 5 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 21 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (deferred work is recorded in section 13 of this design)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (model not configured); native fallback unavailable
- Parallelization: 4 lanes, 2 parallel after PR1 / 2 sequential
- Lake Score: 2/2 (D1 and D4 were scored; both answers picked the higher-completeness option; D2, D3, D5 differ in kind)

# Design review (gstack /plan-design-review, 2026-11-02)

Target: the admin Verifications page and the driver-app re-verify screen in this document. Text-only review (no
generated mockups). DESIGN.md exists at the repo root; tokens cited as `{colors.primary}`, `{colors.success}`,
`{colors.warning}`, `{colors.error}`, Space Grotesk display, "Status Pills / Chips", "Data Tables (Admin)". Mode:
OPERATE (admin) and a single-task mobile flow (driver). Initial rating: admin 3/10, driver 6/10.

## Design decisions (each approved individually)

- **DD1 Admin layout (owner: A).** Split view. Left: queue list sorted fail first, then lowest similarity; header
  shows "N waiting / budget 30"; filter chips Needs review / Overdue challenges / Resolved today. Right: new photo
  and reference photo side by side with click-to-zoom, similarity with a band chip (`{colors.success}` pass,
  `{colors.warning}` review, `{colors.error}` fail) and a plain-language reason, the driver's last 10 outcomes,
  and buttons Looks fine / Mismatch (note required) / Waive challenge. The next case opens after a decision. Keys:
  J/K move, O looks fine, M mismatch. Stacks vertically under 1024 px. No card mosaic, no gradients.
- **DD2 Driver reject states (owner: A).** Quality retakes (`NO_FACE`, `MULTIPLE_FACES`, `POOR_QUALITY`,
  `FACE_ANGLE`, `NO_PLATE_TEXT`) show one instruction line on the failed step ("Move to better light", "Show your
  full face", "Keep the whole plate in the frame"); only that camera step reopens and the other photo is kept.
  `VERIFICATION_FAILED` (block mode) shows "We couldn't verify this photo", attempts left and a Contact support
  button; scores and match reasons are never shown. At the retake limit: "An admin will review this" + Contact support.
- **DD3 Why offline (owner: A).** Push "Quick safety check to keep going" (new `notification_templates` row) when the
  driver is taken offline. The screen opens in re-verify mode: title "Quick safety check", line "Take a selfie and a
  photo of your number plate to go online", existing Step 1 of 2 / 2 of 2. The trigger is never named.
- **DD4 Consent (owner: A).** One-time card before the first verification camera: what is checked (face, number
  plate), why (account safety), how long photos are kept (`verification_retention_days`), Agree button, privacy
  link. Stored as `drivers.verification_consent_at` + app version. Declining keeps the driver offline with Contact
  support. Legal wording confirmed by the owner (O2) before flag mode.

## Interaction states

```
FEATURE                | LOADING                 | EMPTY                    | ERROR                          | SUCCESS            | PARTIAL
-----------------------|-------------------------|--------------------------|--------------------------------|--------------------|-----------------------
Admin queue list       | skeleton rows (5)       | "All caught up" + count  | "Couldn't load, Retry"         | list + budget chip | over budget: amber chip
Admin case pane        | photos fade in, spinner | "Pick a case"            | expired photo link: reload btn | next case opens    | reference missing note
Admin resolve          | button spinner, disabled| —                        | 409 "Already resolved" refresh | toast + next case  | —
Driver consent card    | —                       | —                        | decline -> Contact support     | Agree -> camera    | —
Driver selfie/plate    | camera spinner (exists) | —                        | retake line on failed step     | step done check    | one photo kept
Driver submit          | "Checking your photo"   | —                        | network: retry keeps photos    | back online        | —
Driver blocked/review  | —                       | —                        | neutral failure + support      | —                  | attempts left shown
```

## Journey (storyboard)

| Step | Driver does | Driver feels | Plan specifies |
|------|-------------|--------------|----------------|
| 1 | Finishes a ride, app goes offline | Surprise | push "Quick safety check to keep going" (DD3) |
| 2 | Taps go online | Mild annoyance | 428 opens re-verify screen, calm title (DD3) |
| 3 | First time only: consent card | Wary | plain three lines, Agree (DD4) |
| 4 | Selfie then plate | Hurried | existing oval/rectangle guides, Step 1 of 2 |
| 5 | A photo is rejected | Frustrated | specific line, only that step reopens (DD2) |
| 6 | Passes | Relief | straight to go-online mode screen |

5-second: calm title and one line. 5-minute: two photos, no dead ends. 5-year: routine safety, never an accusation.

## Admin wireframe (approved layout)

```
+--------------------------------------------------------------------------------+
| Verifications            [Needs review 14] [Overdue 2] [Resolved today]        |
| 14 waiting / budget 30                                                         |
+---------------------------+----------------------------------------------------+
| > Ravi K.   FAIL  41%  *  |  New photo        Reference photo                  |
|   Sita P.   REVIEW 82%    |  [   image   ]    [   image   ]   click to zoom    |
|   Amit D.   REVIEW 85%    |  Similarity 41% [FAIL]  Reason: low similarity     |
|   ...                     |  Last 10: pass pass pass review fail ...           |
|                           |  [Looks fine O] [Mismatch M (note)] [Waive]        |
+---------------------------+----------------------------------------------------+
```

## Pass scores

| Pass | Before | After | Remaining gap |
|------|--------|-------|---------------|
| 1 Information architecture | 3 | 8 | none specified for list density at 1,000 drivers |
| 2 Interaction states | 4 | 7 | pending items P1-P3 below |
| 3 Journey and emotional arc | 5 | 8 | copy needs native-language review |
| 4 AI slop risk | 7 | 8 | no mockup rendered; hard rejections: none (split layout, not stacked cards) |
| 5 Design system alignment | 6 | 8 | no new component beyond "Status Pills" and "Data Tables (Admin)" patterns |
| 6 Responsive and accessibility | 4 | 6 | pending items P4-P5 below |

Overall: 6/10 -> 7.5/10. Pass 7 (decision register): DD1-DD4 approved; P1-P5 pending.

## Design items P1-P5 (defaults approved by the owner on 2026-11-02)

- **P1** Admin empty / error copy: "All caught up" with the day's count; load error with Retry.
- **P2** Concurrent resolve: second admin gets 409 "Already resolved", the list refreshes silently.
- **P3** Photo links expire after 1 h: on image error, re-request signed URLs and retry once.
- **P4** Accessibility: driver touch targets at least 44 px, TalkBack labels on shutter and retake, a low-light hint
  on the selfie step; admin focus order list -> case -> buttons, band chips carry text not colour alone.
- **P5** Submit copy: "Checking your photo" with the button disabled, and photos kept on a network failure.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (plan review) | Independent 2nd opinion | 1 | unavailable | model not configured; native fallback unavailable |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 28 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 6/10 -> 7.5/10, 4 decisions, 5 pending |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**OUTSIDE COVERAGE:** codex, plan-review, unavailable (no plan-review model for the custom endpoint); no native fallback.

**VERDICT:** ENG REVIEW COMPLETE (no critical gaps); DESIGN REVIEW 4 decisions + P1-P5 defaults approved by the owner; outside coverage unavailable.

NO UNRESOLVED DECISIONS
