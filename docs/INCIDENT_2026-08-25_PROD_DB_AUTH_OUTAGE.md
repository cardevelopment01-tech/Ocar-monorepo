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
| P0 | Add alerting on HTTP 5xx rate, BullMQ scheduler job failure rate, and Postgres auth error codes (`28P01`/`28000`) — this entire incident should have paged someone before a user found it. | Ops |
| P0 | Fix `deploy.yml`'s rollback logic — it compares image tags that are always `latest`, so "previous tag" and "current tag" are indistinguishable and rollback silently no-ops. Tag by SHA and track the SHA, not `latest`. | Eng |
| P1 | Decide deliberately, outside incident pressure, whether to retry RDS IAM database authentication. If yes: create a dedicated non-master DB role for the app's connections (never grant `rds_iam` to `ocar_admin` again), test the full grant/revoke/connect cycle in staging first, and convert `migrate.ts` to the same auth mode so there's no password-based path left to drift. | Eng |
| P1 | Add a scheduled check (even a simple cron/Lambda) that diffs `migration-database-url` and `api-env`'s `DATABASE_URL` host against the actual current RDS endpoint and Secrets Manager value, alerting on any mismatch — closes the exact gap that caused root causes #1 and #2. | Ops |
| P2 | Rotate the RDS master password again as routine hygiene, given it was pasted into a chat transcript during this incident. | Ops |
| P2 | Document the RDS Postgres IAM-auth-changes-pg_hba-routing behavior somewhere durable (this doc, plus a code comment in `rds.tf`) so it isn't rediscovered the hard way again. | Eng |
| P3 | Consider replacing the hand-maintained SSM `SecureString` workflow with a real secrets manager (already an open item in `CLAUDE.md`'s pending-ops notes) — this incident is the second concrete instance of that gap causing a real production mistake, after the 2026-08-12 Redis→Valkey cutover edit. | Eng |

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
