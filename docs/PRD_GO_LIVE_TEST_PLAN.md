# prd go-live test plan

Purpose: decide, on evidence, whether the new production environment (`prd`) can take `api.ocarindia.com`. Run it
against the **test hostname** (`staging.ocarindia.com`), never against the live hostname. How to operate the environments
is in `docs/INFRA_ENVIRONMENTS.md`; the switch itself is `docs/PRD_CUTOVER_CHECKLIST.md`.

## 0. Rules while testing on prd

- Use **your own phone number only** for OTP login. Prd has the live SMS, FCM, PayU, RazorpayX and Exotel keys.
- The prd data is a copy of the 16 Oct snapshot, and it is **overwritten at the data refresh**, so anything created here is
  disposable. Do not rely on it surviving to go-live.
- **Payments return to `api.ocarindia.com`** (prod) because `API_BASE_URL` in prd's `/ocar/prd/api-env` still names the
  live host, and PayU's return and webhook URLs are built from it. Do not test PayU until it is pointed at the test
  hostname (and put back before cutover). Masked calls need no callback: call masking now uses BulkSMSPlans, which has no
  push webhook, so the old `EXOTEL_*` keys in `api-env` are unused leftovers and `/webhooks/exotel/status` returns 404 by design.
- Never run load above what the prod tests allow at the same time; prd and prod share the third-party accounts.
- **A driver cannot go online on a restored copy until their vehicle is `active`.** The 16 Oct snapshot has every vehicle
  `pending`. The supported way is the admin API: `PATCH /api/v1/admin/drivers/:id/status` with `suspended`, then `active`
  (re-activating moves the primary pending vehicle to `active`). Do it for your own test driver only. Then stamp today's
  daily-verification rows (or take the selfie and plate photo in the app) before going online. Done for driver 570 on 2026-10-29.

## 1. Automated checks (about 5 minutes)

| Check | Command | Passes when |
|---|---|---|
| Platform, public reads, auth enforcement, webhook rejection, error hygiene, CORS | `BASE_URL=https://staging.ocarindia.com node infra/scripts/prd-readiness-check.mjs` | all checks pass (exit 0) |
| Same, with identity per role | add `RIDER_TOKEN=... DRIVER_TOKEN=... ADMIN_TOKEN=...` | each role resolves on `/auth/me`; rider and driver tokens are refused on admin routes |
| Every route is exercised by a script | `node load-tests/verify/route-coverage.js` | 0 uncovered (209 routes; 134 covered by k6, 75 documented out of scope) |

The readiness script never sends an SMS or creates a ride, payment or payout. It refuses to run against the live hostname.

## 2. Functional flows (k6 scripts already in `load-tests/k6`, one user, one iteration)

Run with `BASE_URL=https://staging.ocarindia.com`, tokens minted for users that exist in prd's database (tokens are signed
with the same JWT secret as prod, so a prod-minted token for a user that exists in the snapshot works; the file is gitignored).

| Flow | Script | What it proves |
|---|---|---|
| Whole ride, rider + driver, cash | `lifecycle.js` | estimate, book, dispatch, accept, OTP start/end, payment, ratings, wallet ledger |
| Rider journeys (one-way, round trip, rental, stops, cancel) | `rider-journeys.js` | the booking variants |
| Edge cases | `edge-flows.js` | expiry, no-driver, double accept, cancel races |
| Driver onboarding / daily verification | `onboarding.js`, `daily-verification.js` | document upload to S3, approvals |
| Safety | `safety-writes.js` | SOS, ratings, disputes |
| User extras | `user-extras.js` | saved places, emergency contacts, notifications |
| Admin | `admin-ops.js` | the admin read and write endpoints (needs `ADMIN_TOKEN`) |
| Realtime | `realtime.js` | Socket.io: tracking, ride room, notifications |

Skip `payu-collections.js` and `payments-webhook.js` until `API_BASE_URL` is changed (section 0).

## 3. Manual matrix (what scripts cannot judge)

Do these once, with a real device or browser pointed at the test hostname. Tick each.

- [ ] **Rider app**: OTP login, home, fare estimate, book, live tracking, in-ride chat, masked call to the driver, cancel, rate, history, saved places, notifications.
- [ ] **Driver app**: OTP login, go online (daily verification), receive and accept a ride, navigate, start and end with OTP, cash collection, earnings, wallet, notifications.
- [ ] **Admin portal**: login with TOTP, overview, drivers (approve, suspend), live map, rides, payments, payouts (switch stays off), settings and notification templates.
- [ ] **Web apps**: user and driver sites load against the test API (needs the test origin in `ALLOWED_ORIGINS`).
- [ ] **Push and SMS**: one of each arrives on your own device.
- [ ] **Payments** (only after section 0 change): one small PayU payment in test conditions and its return page; wallet top-up for a driver.
- [ ] **Logs and metrics**: your test ride shows up in Loki with `env=prd`, metrics in Mimir, a trace in Tempo.

## 4. Infrastructure checks

- [ ] Scaling: drive load past one server's share (use the existing `spike.js`) and confirm a second server joins, serves, and scales back in. Detailed monitoring is on, so expect minutes, not 15.
- [ ] Failover: reboot `ocar-prd-db` with failover, confirm the API reconnects (prd only). It is Multi-AZ now.
- [ ] Restore test: restore the latest automatic backup of `ocar-prd-db` to a new instance, connect, count rows, delete the test instance.
- [ ] Deploy pipeline: after PR #240 is merged, run the Deploy workflow for `prd` from `main` and confirm migrations, the blue/green flip and the SSM instance-tag condition all pass.
- [ ] Alerts: fire one test alert per channel and confirm it reaches you. Grafana alerts are not environment-scoped yet; fix that first or prd noise mixes into prod's alerts.
- [ ] Backups and protection: retention 14 days, deletion protection on, final-snapshot name free.

## 5. Go / no-go gates

All must be true. Anything open means do not switch DNS.

1. Section 1 and 2 pass; section 3 has no failed item.
2. The data-refresh method is chosen **and rehearsed once** (a fresh restore may hit the same RDS capacity error, so know the fallback: `db.t3.medium` or `db.t4g.large`).
3. PR #240 is merged and a prd deploy through the pipeline has succeeded.
4. `API_BASE_URL` is `https://api.ocarindia.com` again, and the PayU, Razorpay and BulkSMSPlans dashboards (webhook URLs, any IP allow-lists) are confirmed to work with prd.
5. Cloudflare: the record for `api.ocarindia.com` can be flipped, its TTL is low, and the rollback (flip back) is written down.
6. Grafana alerts and dashboards show prd correctly and do not mix with prod.
7. The prod soak and load tests are finished, and the owner has agreed the window.
8. A rollback owner and a rollback window are named (checklist section 7).

## 6. Suggested timing

| When | Do |
|---|---|
| Tonight | Test hostname live; section 1 and the k6 functional flows; fix what they find |
| Tomorrow morning | Manual matrix on real devices; infrastructure checks; rehearse the data refresh |
| Tomorrow midday | Go/no-go against section 5 |
| Only if every gate is green | Merge, deploy, data refresh, flip DNS, watch 30 minutes (cutover checklist sections 5 to 7) |

If any gate is red, do the cutover on the next clear day. A rushed cutover is the one failure that touches real riders.
