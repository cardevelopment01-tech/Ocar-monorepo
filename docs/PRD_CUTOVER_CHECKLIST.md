# prd cutover checklist

**Goal:** new production = Terraform environment `prd` (`api.ocarindia.com`). The current `prod` stack (`ocar-prod-*`)
stays up untouched until prd has passed its tests, then becomes the new **staging**. The old `staging` environment is
deleted. Terraform keeps the value `prod` for the current stack (renaming would replace immutable resources, including
the DB). Written 2026-10-29. Nothing below has been applied yet.

**Hard rules (until the point of no return, section 7):**
- No `apply` against prod state from `infra/terraform` ever. Prod plans are `plan -lock=false` only.
- Always use `TF_DATA_DIR=.terraform-prd` for prd. Check `.terraform/terraform.tfstate` still says `prod/terraform.tfstate`.
- prod's DB (`ocar-prod-db`) keeps deletion protection on. Restores always go to a NEW instance.
- Every `[A]` step below needs explicit approval from the owner before it runs.

---

## 0. Decisions to settle first

- [ ] **Data refresh method at cutover** (section 5): A) write freeze + fresh snapshot + rebuild prd DB, or B) logical replication. A means minutes-to-an-hour of downtime; B means near-zero but needs a publication created on the live prod DB.
- [ ] **Rollback window:** how many days the old stack runs untouched after cutover (suggest 7).
- [ ] **New staging hostname:** the old staging uses `staging.api.ocarindia.com` and goes away. prod still has no tfvars (its hostname is the `domain_name` default, now `api.ocarindia.com` on main; the live cert is `ocar-api.clienttesting.in` with `api.ocarindia.com` as a SAN). Once `api.ocarindia.com` moves to prd, give the prod stack its own hostname (a `prod.tfvars` or new default, new cert + CNAME), or it keeps claiming prd's name.
- [ ] Where `api.ocarindia.com` points today in Cloudflare (proxied or DNS-only, target, TTL). Prod's `api-env` already uses `API_BASE_URL=https://api.ocarindia.com`, so PayU/Exotel callbacks and the mobile apps already use that hostname. Cutover is a DNS flip, not a client change.
- [ ] Cutover window and who is on call.

## 1. Prerequisites (no AWS changes yet)

- [ ] Create GitHub Environment **`prd`**: deployment branch = `main` only, required reviewer. (Repo admin needed.)
- [ ] Review and commit the Terraform and `deploy.yml` changes via PR. `prd.tfvars` is gitignored, so use `git add -f`. Add `.terraform-prd/` to `.gitignore`.
- [ ] Confirm the DB source snapshot `ocar-prod-db-keep-pre-seed-20261016` is still `available` (it is a manual snapshot; it does not expire).
- [ ] Check what is in that snapshot that can act on its own once prd boots with live keys: `system_config.driver_payouts_enabled`, pending payouts, queued/scheduled notifications, payment-reconcile candidates. Disable or neutralise before first boot if needed.
- [ ] Pre-created already in `/ocar/prd/`: `api-env` (prod copy without DB/Redis/ALLOY keys), `ghcr-token`, `active-color=blue`, `blue/image-tag` and `green/image-tag=sha-24779f5`. Re-verify they are still present and the image tag still exists in GHCR.
- [ ] Cloudflare: have the ACM DNS-validation CNAME for `api.ocarindia.com` ready (appears during the apply).
- [ ] Check Grafana Cloud active-series headroom (15,000 cap). A second fleet adds series; look at current usage before prd starts shipping metrics.

## 2. Build prd `[A]`

- [ ] `TF_DATA_DIR=.terraform-prd terraform init -reconfigure -backend-config=prd.backend.hcl`
- [ ] `TF_DATA_DIR=.terraform-prd terraform plan -var-file=prd.tfvars -out=prd.tfplan` and review (expect ~71 adds, 0 change/destroy; DB `ocar-prd-db` Multi-AZ, deletion protection on, from the snapshot).
- [ ] Re-run `terraform plan -var="environment=prod" -lock=false` against prod state and confirm: no replace/destroy, DB `ocar-prod-db` unchanged except `apply_immediately`.
- [ ] **Approval, then** `TF_DATA_DIR=.terraform-prd terraform apply prd.tfplan`.
- [ ] While it waits on certificate validation: add the ACM CNAME in Cloudflare (DNS-only). Apply finishes once validation passes.
- [ ] Outputs to capture: ALB DNS name, `dbi-...` resource ID, RDS endpoint, Valkey endpoint, `ocar-prd-gha-deploy` role ARN.

## 3. Bring prd up (still no real traffic)

- [ ] Add `REDIS_URL=rediss://<ocar-prd-valkey primary endpoint>:6379` to `/ocar/prd/api-env` (it was deliberately removed so prd could not use prod's cache).
- [ ] Set repo variables `PRD_ALB_DNS_NAME` and `PRD_GHA_DEPLOY_ROLE_ARN`.
- [ ] Confirm the blue instance boots: ASG healthy, target group healthy, `/health` OK through the ALB DNS name. Confirm `DB_HOST` in the container env is `ocar-prd-db...`, not prod's.
- [ ] Run a deploy through the pipeline: `Deploy` workflow, `workflow_dispatch`, environment `prd`, from `main`. This also proves the new `ssm:resourceTag/Environment` condition on the deploy role (migration step, SendCommand). **Do not apply the deploy-role policy change to prod until this passes.**
- [ ] Verify blue/green mechanics on prd: idle color scales up, preview-header smoke test, listener flip, 10-minute bake, scale-down.

## 4. Test prd (the green gate)

- [ ] Smoke test: login OTP (use the review/test numbers only), ride book/accept/start/end on test data, fare quote, chat, notifications. Use only your own numbers.
- [ ] Payments in PayU **test** conditions only; confirm `PAYU_ENV` behaviour is what you expect for prd.
- [ ] Observability: logs in Loki with `ALLOY_ENV=prd`, metrics in Mimir, traces in Tempo, Alloy healthcheck, alert rules not firing falsely. Check `color` labels.
- [ ] Load: re-run the agreed load tests (`load-tests/`, plan in `load-tests/PRE_LOAD_TEST_PLAN.md`) against prd. Compare with the prod numbers (one t3.medium ≈ 190 users / ~6,000 req/min; breakpoint ≈ 9–11k req/min). Note: the 16 Oct snapshot is the pre-seed one, so prd starts with real-shaped but small data.
- [ ] Failover drill on prd (Multi-AZ): reboot with failover, confirm the API reconnects. **Only on prd.**
- [ ] Backups: confirm automated backups and the 14-day retention are on, and a restore test to a new instance works.
- [ ] Sign-off from the owner/client dev: **prd tests are green.**

## 5. Refresh the data (just before cutover)

Prd's DB is a copy as of 16 Oct, so it is missing everything written to prod since. Pick one:

**A. Write freeze + fresh snapshot + rebuild prd DB** (simple, has downtime)
- [ ] Announce the window. Stop writes to prod (scale the API to 0 or block at Cloudflare), let BullMQ queues drain, confirm no in-flight payments.
- [ ] `[A]` Take a fresh manual snapshot of `ocar-prod-db` (additive). Wait for `available`.
- [ ] Rebuild prd's DB from it. `snapshot_identifier` is `ignore_changes`, so this is a deliberate replace: turn off prd's `deletion_protection` by hand, set a new `db_snapshot_identifier`, `terraform apply -replace=aws_db_instance.main`. Use a different final-snapshot identifier or `skip_final_snapshot` for this one rebuild (the fixed name `ocar-prd-db-final` would collide on delete). Turn protection back on. Prd holds no real data at this point, so this is safe, but double-check you are in the prd data dir.
- [ ] The new instance has a new endpoint, `dbi-...` ID and master secret ARN. Re-apply to refresh the `rds_iam_connect` policy, then refresh the ASG instances so `user_data` re-reads `DB_HOST`/`DB_SECRET_ARN`.

**B. Logical replication** (near-zero downtime, needs approval to touch prod)
- [ ] `[A]` On prod: `CREATE PUBLICATION` (parameter `rds.logical_replication` is already on in code; confirm on live prod). Plan WAL/replication-slot disk impact.
- [ ] Subscribe from prd; wait for the initial sync and lag ≈ 0. Sequences are not replicated: reset them on prd at cutover.
- [ ] At cutover: freeze writes, wait for zero lag, drop the subscription, fix sequences.

Either way:
- [ ] Redis/Valkey needs no copy. Drain queues first so nothing is lost.
- [ ] S3 documents bucket is shared and not Terraform-managed: nothing to move, but confirm prd's `S3_*` values are the same bucket.

## 6. Cutover

- [ ] Lower the Cloudflare TTL for `api.ocarindia.com` the day before if it is DNS-only.
- [ ] Final check: prd `/health` green, prd migrations applied (`migrate` ran in the last deploy), `REDIS_URL` set, queues drained on prod.
- [ ] Switch `api.ocarindia.com` in Cloudflare to the prd ALB. (Prd's ALB serves a valid cert for that hostname.)
- [ ] Watch for 30 minutes: 5xx on the prd ALB, DB connections, CPU, error logs, payment webhooks (PayU return/webhook, Exotel callback, `payment_gateway_events` with `processed=false`), SOS and ride flows, push/SMS delivery.
- [ ] Keep prod running but with its API idle or read-only so nothing writes to the old DB.

## 7. Point of no return

Once prd has accepted real writes, rolling back means losing them (or copying them back). Decide a time (suggest 24 hours of clean running) after which the old DB is no longer a rollback target.

**Rollback before that point:** flip Cloudflare back to the old ALB; the old stack and DB are untouched. After it, rollback needs a reverse data copy and is a separate decision.

## 8. After cutover (code and cleanup)

- [ ] Retarget deployments in `deploy.yml`: `main` → `prd` (GitHub Environment `prd`), and `develop`/manual → the old `prod` stack (now staging; it can keep the GitHub Environment `production`, just a name). Update `terraform-plan.yml` so PRs plan prd as well.
- [ ] Confirm the old stack's CPU policy, DB class and alerts are what you want for a staging role. It remains deletion-protected.
- [ ] **Old staging teardown `[A]`:** after the window, destroy the old `staging` environment via the staging-infra workflow. Then remove the dead staging-only code: `staging.tfvars`, `s3-metrics-archive.tf` and its `user_data` block, the `ocar-*-gha-staging` role (needed nowhere once staging is gone), the `staging` GitHub Environment, `STAGING_*` variables.
- [ ] Update `CLAUDE.md` and `docs/OPS_RUNBOOK.md`: prd = production, prod = staging, hostnames, state keys, SSM paths.
- [ ] Rotate the Exotel status-callback token (it was shown once in terminal output during setup) and any other secret you want fresh.
- [ ] Delete stale `*.tfplan` files and the local `terraform.tfstate*` in `infra/terraform`.
- [ ] After the rollback window: decide whether to snapshot-and-keep or retire the old DB's extra Multi-AZ/size, and re-evaluate costs of running two full stacks.

## Quick reference

| Thing | prod (current → new staging) | prd (new production) |
|---|---|---|
| Terraform `environment` | `prod` | `prd` |
| State key | `prod/terraform.tfstate` | `prd/terraform.tfstate` |
| Terraform data dir | `.terraform` | `.terraform-prd` |
| Names | `ocar-prod-*` (blue keeps legacy names) | `ocar-prd-*-<color>` |
| SSM path | `/ocar/prod/*` | `/ocar/prd/*` |
| DB | `ocar-prod-db`, Single-AZ, protected | `ocar-prd-db`, Multi-AZ, protected |
| Hostname | live cert `ocar-api.clienttesting.in` + SAN `api.ocarindia.com`; main's code wants `api.ocarindia.com` as primary (a plan shows the cert replaced -- do not apply to prod) | `api.ocarindia.com` |
| GitHub Environment | `production` | `prd` (main-only, reviewer) |
