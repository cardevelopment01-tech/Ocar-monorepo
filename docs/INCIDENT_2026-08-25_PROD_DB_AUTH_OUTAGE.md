# Incident Postmortem: Production Database Auth Outage

**Date:** 2026-08-25
**Severity:** SEV-1 — full production API outage (intermittent, then total, then intermittent again during remediation)
**Duration:** Several hours, spanning initial detection through final verified recovery
**Status:** Resolved

## Summary

A production deploy of the API had silently stopped applying database migrations weeks earlier because the CI migration step was pointed at an abandoned database. This was masked until user-facing endpoints started hitting missing tables/columns. Remediation uncovered a second, independent bug (the app's own DB password had gone stale after an automatic AWS-managed rotation), and an attempt to permanently fix that class of problem via RDS IAM database authentication caused a third, self-inflicted outage before the environment was fully stabilized on a corrected password-based configuration.

## Impact

- `GET /api/v1/saved-places` and any other endpoint touching tables/columns added after the last successfully-migrated commit returned HTTP 500.
- `sweep_stale_sos` and `sweep_dispute_sla` scheduler jobs failed on every tick — **SOS alert escalation and dispute SLA breach detection were silently non-functional** for the duration of the drift, a safety-relevant gap, not just a feature bug.
- Later in the incident, all API authentication (`/api/v1/auth/admin/login`, `/api/v1/auth/refresh`) and effectively every DB-backed endpoint returned 500 (`password authentication failed for user "ocar_admin"`) — total outage.
- During remediation, a second deploy attempt caused a brief partial-fleet outage (one instance cycling unhealthy) due to a configuration mismatch introduced mid-fix.

## Timeline

1. **Detection (reactive, not automated):** user observed live application error logs showing `relation "saved_places" does not exist` and `column "escalated_at" does not exist` on the scheduler. No monitoring/alerting flagged this — it was found by manually reading logs.
2. **Root cause #1 identified:** `/ocar/prod/migration-database-url` (a hand-maintained SSM parameter, not Terraform-managed) still pointed at the project's original Neon database from before an earlier RDS cutover. Every deploy's migration step had been "succeeding" against that abandoned database while the live app queried RDS, which never received migrations `089_saved_places.sql`, `093_safety_escalation_columns.sql`, or anything after.
3. While preparing to fix #1, a **second, independent bug** surfaced: `api-env`'s own `DATABASE_URL` password no longer matched RDS's actual current password. The RDS instance uses `manage_master_user_password = true` (AWS/Secrets-Manager-owned, auto-rotating), and the password had rotated at least once since the value was last hand-copied into SSM — a known, documented tradeoff from when the RDS cutover happened ("pull once after apply, hand-maintain"), which nobody had re-pulled since.
4. This second bug caused a **total outage**: every DB-backed request began failing with `password authentication failed for user "ocar_admin"`.
5. **Live credentials were pasted into the assistant chat** while diagnosing (both the Neon and RDS connection strings, including passwords). Flagged as compromised-by-exposure; rotation was already necessary for the incident and this reinforced it.
6. Decision made to fix the underlying password-drift problem properly via **RDS IAM database authentication** (token-based, no stored password) rather than just re-syncing the password once more.
7. Researched and planned the IAM auth change (Terraform: `iam_database_authentication_enabled`, a scoped `rds-db:connect` IAM policy; app: `@aws-sdk/rds-signer`, a `DB_AUTH_MODE` config flag, branching pool construction in `client.ts`). Decision made to apply directly to production rather than staging first, since production was already fully down (no working state to protect).
8. Terraform applied. `iam_database_authentication_enabled` had to be forced with `--apply-immediately` since the Terraform resource doesn't set that flag and AWS had deferred it to the next maintenance window.
9. `GRANT rds_iam TO ocar_admin;` executed.
10. Code pushed. CI passed. Deploy triggered.
11. **Deploy attempt 1 — migration step failed**, not on a bad password but with `PAM authentication failed for user "ocar_admin"`. Root cause: granting `rds_iam` to a role changes which `pg_hba.conf` rule matches that role's connections in RDS Postgres — it does **not** add IAM auth as an option alongside password auth, it **replaces** password auth for that role's matching connections. `migrate.ts` (deliberately not converted to IAM auth in this pass) could no longer authenticate at all.
12. Attempted `REVOKE rds_iam FROM ocar_admin;` using a password connection — **this also failed** with the same PAM error, because the revoke attempt itself needed a password connection that was now blocked by the very grant it was trying to undo. Full lockout.
13. Recovered via `aws rds modify-db-instance --no-enable-iam-database-authentication --apply-immediately` — a pure control-plane API call requiring no database login, which restored normal password-auth routing instance-wide. Verified with a direct `SELECT 1` test.
14. Identified an elevated risk from mid-remediation state: `DATABASE_URL` had been removed from `api-env` (correctly, for the IAM-mode code) but the **old code was still running** on all instances and requires `DATABASE_URL` unconditionally — any instance restart at that point would have crash-looped. Restored `DATABASE_URL` immediately as a precaution.
15. Cleaned up: `REVOKE rds_iam FROM ocar_admin` (now working, since password auth was restored) and `migration-database-url` set to the correct current password.
16. Re-ran the deploy. **Migration step succeeded.** Instance refresh eventually failed anyway — `api-env`'s `DB_AUTH_MODE` had been left as `iam` (incorrectly assessed as "doesn't matter" mid-incident), so new instances tried IAM auth, which had just been revoked/disabled, failed their health checks, and the refresh gave up after its ~30-minute polling ceiling. The workflow's automatic rollback also silently no-op'd (unrelated pre-existing bug — see Action Items).
17. Corrected `DB_AUTH_MODE=password` in `api-env`. Attempted to re-trigger a new instance refresh — blocked with `InstanceRefreshInProgress`, because the *previous* refresh was still genuinely running in the background on AWS's side; the GitHub Actions step had only given up on its own polling loop, not actually stopped the underlying operation.
18. Waited for the existing refresh to complete naturally (~10 more minutes, working through the ASG's health-check grace period and warm-up windows). Reached `Successful` at 100%.
19. **Verified recovery:** all ASG instances healthy, ALB targets healthy, `/health` returns 200, `/api/v1/geo/cities` (a real DB-backed route) returns live data.

## Root Causes

Three independent, compounding issues, not one:

1. **No automated sync between a hand-maintained SSM parameter and the actual database it names.** `/ocar/prod/migration-database-url` was seeded once at RDS cutover time and never touched again — nothing detects or alerts when it silently diverges from reality.
2. **No automated sync between AWS's auto-rotated RDS-managed master password and the SSM-stored copy the app actually uses.** `manage_master_user_password = true` provides no benefit if nothing propagates the rotated value to where the app reads it — this is worse than a fixed password, because it creates the appearance of security rotation while actually just being a ticking time bomb.
3. **Incomplete understanding of RDS Postgres IAM auth semantics before granting it to a shared/master role.** Granting `rds_iam` to `ocar_admin` was assumed to be additive (a new auth option alongside the existing password). It is not — it changes `pg_hba.conf` routing for that role, removing password auth entirely for connections that match the IAM rule.

## What Went Well

- The deploy pipeline's build-then-migrate-then-cutover ordering meant that both failed deploy attempts aborted **before** replacing any running instances with a broken image — the fleet was never made worse by a bad deploy, only by direct, deliberate incident-response actions (the `rds_iam` grant) taken outside the deploy pipeline.
- `migrate.ts`'s idempotency (`pg_advisory_lock`, skip-already-applied) meant re-running migrations repeatedly during remediation was always safe.
- Diagnosis was methodical and each hypothesis was verified against actual command output before acting on it, which caught the `DB_AUTH_MODE` mistake and the "instance refresh already in progress" false alarm quickly rather than compounding them.

## What Went Wrong / Contributing Factors

- **No alerting on 500 rates, scheduler job failures, or DB auth errors.** This entire incident was detected by a human reading raw logs, not by any monitoring system, despite Prometheus/Grafana already being in place for this project.
- **Assistant error:** stated `DB_AUTH_MODE` being left as `iam` in `api-env` "doesn't matter" when it directly gated which connection code path ran. This directly caused the second failed deploy attempt.
- **Assumption that IAM auth could be layered onto an existing password-authenticated master role without side effects.** This should have been verified against AWS documentation or tested in isolation before touching production, especially after already deciding to skip staging.
- **Decision to skip staging validation for an authentication-mechanism change**, made under the reasoning that production was already down so there was "nothing to lose." In practice, the IAM auth change caused a *new*, different failure mode (the PAM lockout) on top of the original one, extending the incident.
- **`deploy.yml`'s automatic rollback is silently non-functional** (see Action Items) — it did not actually protect us during either failed deploy attempt; all recovery was manual.
- **Secrets were pasted into a chat transcript** during live debugging. Necessary in the moment given the tooling available, but not a safe long-term pattern.

## Action Items

| Priority | Action | Owner |
|---|---|---|
| P0 | ~~Add alerting on HTTP 5xx rate, BullMQ scheduler job failure rate, and Postgres auth error codes (`28P01`/`28000`) — this entire incident should have paged someone before a user found it.~~ **Done — see Addendum 3.** 5xx rate already existed; auth-error and scheduler-failure rules applied to Grafana Cloud on 2026-08-25. | Ops |
| P0 | ~~Fix `deploy.yml`'s rollback logic — it compares image tags that are always `latest`, so "previous tag" and "current tag" are indistinguishable and rollback silently no-ops. Tag by SHA and track the SHA, not `latest`.~~ **Done — see Addendum 2.** | Eng |
| P1 | Decide deliberately, outside incident pressure, whether to retry RDS IAM database authentication. If yes: create a dedicated non-master DB role for the app's connections (never grant `rds_iam` to `ocar_admin` again), test the full grant/revoke/connect cycle in staging first, and convert `migrate.ts` to the same auth mode so there's no password-based path left to drift. | Eng |
| P1 | Add a scheduled check (even a simple cron/Lambda) that diffs `migration-database-url` and `api-env`'s `DATABASE_URL` host against the actual current RDS endpoint and Secrets Manager value, alerting on any mismatch — closes the exact gap that caused root causes #1 and #2. | Ops |
| P2 | Rotate the RDS master password again as routine hygiene, given it was pasted into a chat transcript during this incident. | Ops |
| P2 | Document the RDS Postgres IAM-auth-changes-pg_hba-routing behavior somewhere durable (this doc, plus a code comment in `rds.tf`) so it isn't rediscovered the hard way again. | Eng |
| P3 | Consider replacing the hand-maintained SSM `SecureString` workflow with a real secrets manager (already an open item in `CLAUDE.md`'s pending-ops notes) — this incident is the second concrete instance of that gap causing a real production mistake, after the 2026-08-12 Redis→Valkey cutover edit. | Eng |

## Addendum: Permanent Fix

Later the same day, rather than leave the environment on the re-synced-password stopgap, the underlying architectural flaw — no automated way to keep DB credentials in sync — was fixed properly.

### Decision: Secrets Manager, not IAM auth, for the master role

IAM database authentication (the approach explored in the original incident, then reverted after the PAM/`pg_hba` lockout in timeline steps 11–13) was reconsidered and explicitly **not** retried for `ocar_admin`. The lockout wasn't an implementation bug — it's how RDS Postgres actually works: granting `rds_iam` to a role changes which `pg_hba.conf` rule matches its connections, and there is no way to have both password and IAM auth simultaneously available for the same role. Retrying it safely would require a dedicated non-master DB role first (still tracked as a P1 action item below, deliberately deferred).

Instead: `DB_AUTH_MODE=secrets-manager` — the app and `migrate.ts` now read the RDS master password **live from Secrets Manager** on every new physical connection (cached 5 minutes, stale-on-error fallback), instead of copying it into a static SSM parameter by hand. This directly closes root causes #1 and #2 from the original incident: there is no copy left to drift, because there is no copy.

### What shipped

- `api/src/lib/db-secret.ts` — cached Secrets Manager fetch, shared by the app's connection pools and `migrate.ts`
- `infra/terraform/iam.tf` — `secretsmanager:GetSecretValue` granted to the EC2 role, scoped to the RDS master secret; the old `migration-database-url` SSM parameter and its IAM grant **deleted entirely**
- `.github/workflows/deploy.yml` — the migration step now queries RDS live (`aws rds describe-db-instances`) for connection details instead of reading a hand-copied SSM parameter; no secret ever crosses into the workflow

### Bugs found and fixed during rollout

Six real, independent bugs, each caught by an actual deploy failure and root-caused with direct evidence — not assumed or guessed past:

1. **Missing `AWS_REGION`** — the AWS SDK v3 does not auto-detect region from EC2 instance metadata the way it does credentials; both the new Secrets Manager client and the earlier `rds-signer` `Signer` would have thrown "region is missing" at first real use. Caught in review, before it ever reached production.
2. **IMDS hop-limit defaulting to 1** — the launch template's `metadata_options` never set `http_put_response_hop_limit`, which silently blocks any Docker container (bridge network) from reaching the instance's IAM role at all. Would have broken this fix *and* the original IAM-auth attempt regardless of how correct the application code was. Also caught in review.
3. **GitHub Actions deploy role missing `rds:DescribeDBInstances`** — a separate IAM role from the EC2 instance role; granting the instance role wasn't sufficient. Caught via a real `AccessDenied` deploy failure.
4. **`set +H` assumed the wrong remote shell** — AWS-RunShellScript executes via `/bin/sh` (dash), not bash; dash has no `-H` option at all and errored immediately (`Illegal option -H`) before ever reaching the migration command. The original theory (bash history expansion mangling the secret ARN's `rds!`-prefix) was itself wrong — dash never does history expansion, so this was never the actual cause. Removed.
5. **Stale locally-cached `:latest` image** — the actual root cause of bug #4's symptom. This EC2 instance had been running `ocar-api:latest` continuously and already had an old image cached under that tag; `docker run` does not re-pull an image that already exists locally under the same tag. The migration container was silently running pre-fix code every single time, which is why `DB_SECRET_ARN` reached the container's shell correctly (confirmed via a container-side echo) but `migrate.js` still hit the *old* code's error message. Fixed with `--pull always`. Brand-new instances at boot are unaffected (nothing cached yet).
6. **`rejectUnauthorized: true` with no CA configured** — Node's default trust store doesn't include Amazon's RDS CA, so every connection failed with `SELF_SIGNED_CERT_IN_CHAIN`. The first instinct (`rejectUnauthorized: false`) was flagged before being committed — it would have shipped a *weaker* posture than intended without being asked to. Researched AWS's actual documented practice instead: vendored AWS's official global RDS CA bundle and verified the chain properly (`sslmode=verify-full` equivalent), which is both the AWS-recommended approach and what real production deployments use — network isolation (a security group) and certificate verification are complementary controls, not substitutes for each other.

### Final verified state

Fresh ASG instances (new instance IDs, confirming a genuine full instance refresh, not a partial/cached rollout), healthy on both EC2 and ALB health checks, `/health` returns 200, a real DB-backed route (`/api/v1/geo/cities`) returns live data, migrations applied, TLS chain verified, no static password anywhere in the deploy path.

### Action items status update

- The P1 "decide deliberately whether to retry RDS IAM database authentication" item is **answered**: Secrets Manager was chosen instead for the master role specifically because it doesn't have IAM auth's `pg_hba` collision risk at all. IAM auth remains available in the code (`DB_AUTH_MODE=iam`, unused) for a future dedicated non-master app role, if ever wanted — that part of the original P1 item stays open.
- The P1 "scheduled drift-check cron" item is now **moot** for the app/migration credential path — there is no copy left to drift, so nothing to check. Still relevant if `staging`'s equivalent setup is ever hardened the same way.
- The P0 rollback-logic bug is **fixed** — see Addendum 2 below.

## Addendum 2: Rollback Logic Fix

A follow-up pass through the remaining P0/P1 action items above started with the rollback bug, since it's the one most likely to matter on a completely unrelated future deploy.

### Root cause — sharper than "everything is tagged `latest`"

Every image push already carried both a `sha-xxxxxxx` tag and a `latest` tag, correctly. The actual bug was in `docker/metadata-action`'s `version` output — the single value used downstream as `IMAGE_TAG` (the `image-tag` SSM parameter, the migration container, `docker-compose.prod.yml`'s `${IMAGE_TAG}` substitution). `metadata-action` selects `version` by a fixed type-priority table where `type=raw` (priority 200) beats `type=sha` (priority 100) by default — so `version` always resolved to `"latest"` regardless of the sha tag also existing. That made the "Record previous image tag" step's `PREV` always equal the new deploy's `IMAGE_TAG` (`"latest" == "latest"`), so the rollback step's `[ "$PREV" != "$IMAGE_TAG" ]` check was permanently false: "no distinct previous tag found," on every deploy, whether or not the deploy was actually bad.

### Fix

One change, in `deploy.yml`'s `Docker metadata` step — explicit `priority=` on each tag rule so the sha tag wins the `version` output:

```yaml
tags: |
  type=sha,prefix=sha-,format=short,priority=900
  type=raw,value=latest,enable={{is_default_branch}},priority=200
```

No other file needed to change. `docker-compose.prod.yml`, `user_data.sh.tpl`, and the migration step already treat `IMAGE_TAG` as a generic variable sourced from the SSM parameter — none of them hardcode `"latest"` except as compose's local-dev fallback default. `latest` is still pushed as a convenience tag for manual `docker pull`; it just no longer drives the deploy or rollback pipeline.

### Verification

This is a workflow-only change (no `terraform apply`, no live prod state change) — it will prove itself on the next real deploy, when the `image-tag` SSM parameter should show a `sha-xxxxxxx` value instead of `latest` for the first time.

## Addendum 3: Legacy TLS Path + Missing Auth/Scheduler Alerting

A further pass through the remaining action items closed the two lower-priority gaps flagged in earlier addenda: the legacy password-mode path never got the CA-bundle TLS fix, and this incident's own failure mode (a full DB auth outage) had no alert that would have caught it.

### Legacy `DATABASE_URL`/password-mode TLS verification

Only the `iam`/`secrets-manager` auth modes got the CA-bundle fix in the original Addendum. The default `password` mode (dormant in prod today — prod runs `DB_AUTH_MODE=secrets-manager` — but still the schema default, and the active mode in local dev/CI and if anyone ever reverts) never did. Investigating turned up a sharper bug than "missing verification":

- `pg`'s own connection-string parser does `config = Object.assign({}, config, parse(config.connectionString))` — the URL's own `sslmode` **overwrites** an explicit `ssl` object passed alongside `connectionString`, not the other way round. Adding `ssl: { ca, rejectUnauthorized: true }` next to the existing `connectionString: config.DATABASE_URL` would have been silently clobbered by the URL's `sslmode` param.
- `sslmode=require` alone (no `sslrootcert`) resolves to `{ rejectUnauthorized: false }` in `pg-connection-string` — encrypted, unverified. That's the actual current posture of the legacy path.
- Naively applying the vendored RDS CA bundle to any connection with `sslmode` present would have broken staging, whose DB is a Neon branch (see `CLAUDE.md`), not RDS — Neon's cert already chains to a public CA in Node's default trust store, and verifying against the *RDS* CA would fail for a non-RDS host.

Fix (`client.ts` and `migrate.ts`, matching functions): only touch the connection when `sslmode` is actually present in the URL (never set for the plain local/CI `DATABASE_URL` in `api/.env.example`, so that path is untouched); strip `sslmode` and pass an explicit `ssl` object instead — the vendored RDS CA bundle for an `*.rds.amazonaws.com` host, or bare `rejectUnauthorized: true` (Node's own default trust store) for anything else.

### Alerting gap

Re-examined against the actual state of `infra/terraform/observability/` rather than assumed from scratch — alerting already existed (5xx rate on rides/payments, `pg.Pool` exhaustion, GPS-flush latency, disk usage, wired to Slack+email via `grafana_contact_point.default`/`grafana_notification_policy.root`). The real gaps were narrower than "no alerting," matching this doc's own P0 wording exactly:

- **Postgres auth error codes (28P01/28000)** — nothing exported these. Added `pg_query_errors_total{code}` (a `Counter`, `api/src/observability/metrics.ts`), incremented in `client.ts`'s `query()` — the single path most traffic already goes through — whenever a Postgres error carries a `.code`. New Grafana rule: `sum(increase(pg_query_errors_total{code=~"28P01|28000"}[1m])) > 0`, `for: 1m`, severity critical (a real auth break fails every query immediately and repeatedly, so 1 minute is enough to confirm it's not a blip).
- **BullMQ scheduler job failures** — needed no app change at all. `bullmq_queue_job_counts{queue,state}` already existed, and `scheduler` is already a real queue name (`api/src/jobs/queues/index.ts`). New Grafana rule: `bullmq_queue_job_counts{queue="scheduler", state="failed"} > 2`, `for: 10m`, severity warning.

Both new rules were added to the existing `grafana_rule_group.static_thresholds` in `alerts-static.tf` — no new notification plumbing needed.

### Verification

`npx tsc --noEmit` passes. The `client.ts`/`metrics.ts` mutual import (client.ts now imports the new counter from metrics.ts, which already imported `pool` from client.ts) was checked directly rather than assumed safe: a standalone import-and-increment smoke test confirmed both modules resolve correctly and the new metric appears in `register.metrics()` output. `terraform validate` passed, and `terraform apply` against `infra/terraform/observability/` completed successfully on 2026-08-25 — both new rules are live in Grafana Cloud. Still not verified against a real induced 28P01 error (the `pg_query_errors_total` counter has never actually incremented in prod) — that's a reasonable follow-up (e.g. next time credentials are rotated, briefly confirm the alert fires) rather than something to force artificially now.

## Appendix: Key Commands Used During Remediation

```bash
# Diagnose SSM parameter drift
aws ssm get-parameter --name /ocar/prod/migration-database-url --with-decryption --query Parameter.Value --output text
aws ssm get-parameter --name /ocar/prod/api-env --with-decryption --query Parameter.Value --output text

# Force an immediate (not maintenance-window-deferred) RDS modification
aws rds modify-db-instance --db-instance-identifier ocar-prod-db --enable-iam-database-authentication --apply-immediately
aws rds modify-db-instance --db-instance-identifier ocar-prod-db --no-enable-iam-database-authentication --apply-immediately

# Get RDS's actual current (Secrets-Manager-managed) master password
aws rds describe-db-instances --db-instance-identifier ocar-prod-db --query "DBInstances[0].MasterUserSecret.SecretArn"
aws secretsmanager get-secret-value --secret-id <arn> --query SecretString --output text

# Run one-off SQL against RDS via SSM (RDS isn't publicly reachable)
aws ssm send-command --instance-ids <id> --document-name "AWS-RunShellScript" \
  --parameters file://commands.json --query "Command.CommandId" --output text
aws ssm get-command-invocation --command-id <id> --instance-id <id> \
  --query "{Status:Status,Out:StandardOutputContent,Err:StandardErrorContent}"

# Check real instance-refresh state vs. what the deploy workflow's own polling loop gave up on
aws autoscaling describe-instance-refreshes --auto-scaling-group-name ocar-prod-asg --max-records 1
aws elbv2 describe-target-health --target-group-arn <arn>
```
