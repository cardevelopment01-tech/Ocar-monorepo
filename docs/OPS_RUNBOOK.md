# Ops Runbook — Production Infra

Practical "how do I do X" reference for operating the prod fleet. For the
architecture rationale (why ASG/ALB, why no NAT gateway, why local state
originally, etc.) see `docs/TERRAFORM_INFRA_BRIEF.md`. For standing up
staging, see `docs/superpowers/specs/2026-08-14-staging-runbook.md`.

Prereqs for anything here: `aws` CLI configured with prod credentials (or
rely on the GitHub Actions OIDC role — see "Who can do what" below),
Terraform 1.15.8, repo checked out, working directory `infra/terraform`.

## Deploy new API code

Fully automatic, **blue/green** (changed 2026-08-30, see
`docs/superpowers/specs/2026-08-28-blue-green-deployment-design.md` and
`docs/superpowers/plans/2026-08-30-blue-green-deployment-implementation.md`
for the full design/implementation history) — merge to `main` triggers
`.github/workflows/ci.yml`, which on success triggers
`.github/workflows/deploy.yml`: builds the image, pushes to GHCR, runs
migrations against the shared RDS instance, then cuts over to the idle
color instead of doing an in-place rolling refresh:

1. Reads `/ocar/prod/active-color` (SSM) to find which color is currently
   live, computes the other one as idle.
2. Writes the new image tag to the idle color's own SSM parameter
   (`/ocar/prod/{blue,green}/image-tag`) — the live color's parameter is
   untouched.
3. Scales the idle color's ASG up, health-checks it, then smoke-tests it
   directly through the ALB via a preview header
   (`X-Deploy-Preview: blue`/`green`) — no live traffic reaches it until
   this passes.
4. Flips the ALB listener's default target group to the idle color — the
   one atomic moment traffic actually moves.
5. Bakes for 10 minutes watching `HTTPCode_Target_5XX_Count` on the new
   active color. Instant listener-flip rollback if it trips.
6. Scales the old color down to 0 once the bake is clean.

Both colors' ASGs exist in Terraform at all times with `min_size` /
`desired_capacity` runtime-controlled by the pipeline, not Terraform (see
`asg.tf`'s `lifecycle.ignore_changes`). **Blue kept its exact
pre-blue/green resource names** (`ocar-prod-asg`, `ocar-prod-api-tg`, no
color suffix) — renaming a live ASG/target group forces AWS to
destroy-and-recreate it, so blue never got the new `-blue` suffix; green
uses the clean `ocar-prod-asg-green` / `ocar-prod-api-tg-green` naming.
This asymmetry is permanent and intentional, not a bug — see
`asg.tf`/`alb.tf`'s comments on it.

Find which color is live right now:
```bash
aws ssm get-parameter --name /ocar/prod/active-color --query 'Parameter.Value' --output text
```

**No manual step needed for a normal deploy.** Only touch this if the
pipeline itself is broken.

**Manual rollback** (if the automatic bake-window rollback didn't fire, or
you need to go back further than the immediately-preceding deploy). This
mirrors exactly what `deploy.yml`'s own "Flip the listener" /
"Resume scaling" steps do — copy-pasteable as-is:
```bash
ACTIVE=$(aws ssm get-parameter --name /ocar/prod/active-color --query 'Parameter.Value' --output text)
if [ "$ACTIVE" = "blue" ]; then IDLE="green"; else IDLE="blue"; fi
if [ "$IDLE" = "blue" ]; then IDLE_ASG="ocar-prod-asg"; IDLE_TG="ocar-prod-api-tg"; else IDLE_ASG="ocar-prod-asg-green"; IDLE_TG="ocar-prod-api-tg-green"; fi
echo "Rolling back: $ACTIVE (currently live) -> $IDLE"

# Bring the target color back up if it had already been scaled to 0 (harmless no-op if it's still at 2)
aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$IDLE_ASG" --min-size 2 --desired-capacity 2

# Wait until it's healthy before flipping -- poll this until targets show "healthy"
IDLE_TG_ARN=$(aws elbv2 describe-target-groups --names "$IDLE_TG" --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 describe-target-health --target-group-arn "$IDLE_TG_ARN"

# Flip the listener
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn \
  "$(aws elbv2 describe-load-balancers --names ocar-prod-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)" \
  --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text)
aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" --default-actions "Type=forward,TargetGroupArn=$IDLE_TG_ARN"
aws ssm put-parameter --name /ocar/prod/active-color --type String --value "$IDLE" --overwrite

# Restore the redundancy floor on the color that's now live, drop it on the one going idle
aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$IDLE_ASG" --min-size 2
aws autoscaling resume-processes --auto-scaling-group-name "$IDLE_ASG" --scaling-processes AlarmNotification
OLD_ASG=$([ "$ACTIVE" = "blue" ] && echo "ocar-prod-asg" || echo "ocar-prod-asg-green")
aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$OLD_ASG" --min-size 0
aws autoscaling suspend-processes --auto-scaling-group-name "$OLD_ASG" --scaling-processes AlarmNotification
```
Migrations are forward-only — rolling back the color does **not** undo a
migration. If a bad migration is the actual problem, fix it forward with a
new migration file, don't try to revert.

## Diagnose a failed blue/green deploy

Real failure modes hit during the initial rollout (2026-08-30), kept here
because they're exactly what you'll see again if they recur:

- **`AccessDenied` on `elasticloadbalancing:Describe*` calls in the deploy
  workflow logs.** ELBv2 `Describe*` actions (`DescribeTargetHealth`,
  `DescribeTargetGroups`, `DescribeListeners`, `DescribeLoadBalancers`) do
  **not** support resource-level IAM scoping — they need `Resource: "*"`.
  If someone re-scopes them to a specific ARN in `github-oidc.tf`'s
  `github_actions_deploy` policy (looks tempting, "least privilege"), every
  poll fails and the deploy times out after burning its full retry budget.
  Check `aws_iam_role_policy.github_actions_deploy` in
  `infra/terraform/github-oidc.tf` first if you see this.
- **The live color quietly drops to 1 instance (or fewer) during a quiet
  traffic period, with no deploy running.** The redundancy floor
  (`min_size=2` on whichever color is active) is runtime-managed by
  `deploy.yml`, not Terraform — if `asg.tf`'s `lifecycle.ignore_changes`
  ever loses `min_size` (e.g. someone "simplifies" it), the next
  unrelated `terraform apply` silently resets it to 0, and the
  pre-existing request-count-tracking policy is then free to scale the
  live color down with nothing stopping it. Check
  `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names
  ocar-prod-asg ocar-prod-asg-green --query 'AutoScalingGroups[].{Name:AutoScalingGroupName,Min:MinSize,Desired:DesiredCapacity}'`
  — whichever is currently active per `/ocar/prod/active-color` should
  always show `Min: 2`.
- **Terraform wants to destroy/recreate `ocar-prod-asg` (or the target
  group / launch template / scaling policy) on an unrelated `plan`.**
  Their `name`/`name_prefix` is immutable — if that diff ever appears,
  something changed blue's naming away from its legacy unsuffixed form.
  Do not apply; fix the naming back to match live state first (see the
  comments in `asg.tf`/`alb.tf`/`launch-template.tf` explaining why blue is
  asymmetric).
- **An unrelated `terraform apply` (e.g. an AMI bump) wants to flip a
  color's `suspended_processes` back to empty.** Same root cause as the
  `min_size` gap above — `AlarmNotification` is suspended on whichever
  color is currently idle (deliberately, indefinitely, not just mid-cutover)
  by `deploy.yml`'s runtime calls, not by Terraform. If `asg.tf`'s
  `lifecycle.ignore_changes` ever loses `suspended_processes`, the next
  apply silently re-enables scaling on the idle color. Not usually harmful
  on its own (the idle color has 0 instances anyway), but it means the
  ASG's scaling behavior no longer matches what the deploy workflow assumes.
- **Grafana dashboards/alerts show empty or stale data despite the fleet
  being healthy (e.g. "Live Instances" shows 0).** Check
  `docker logs ocar_alloy --tail 100` on a live instance (via
  `aws ssm send-command`, no SSH) for repeated `429 Too Many Requests` /
  `err-mimir-max-active-series` or `err-mimir-tenant-max-ingestion-rate`
  errors. Hit for real during the 2026-08-30 blue/green rollout:
  `node_exporter` shipped ~500-700 unfiltered series/host, and four
  instance refreshes in ~2 hours (each replacing every host identity)
  pushed Grafana Cloud's 15,000 active-series tenant cap over the edge —
  every remote_write got rejected, so nothing showed up anywhere, even
  though `/health` and the ALB were completely fine the whole time. Now
  filtered (`config.alloy`'s `prometheus.relabel "node"` keeps ~15 families;
  `docker-compose.prod.yml`'s `--collector.netdev.device-exclude` drops
  Docker's ephemeral veth/docker/br/cni interfaces at the source) — if this
  recurs, it's either another unusually rapid burst of instance churn (should
  self-resolve in 15-30 min as stale series age out) or a new metrics source
  that also needs the same two-layer filtering treatment (the API's own
  `http_request_duration_seconds` is still unfiltered: 396 of the API's 667
  series on one host in the 2026-10-17 tests, and it grows with every route used).
  **It recurred on 2026-10-17** (soak tests parts 2 and 3: every scaled-out deploy
  blanked all dashboards for 25+ minutes). Measured on one host: `postgres_exporter`
  alone exposed ~3,400 series (`pg_stat_user_tables_*` + `pg_statio_user_tables_*` ~2,800),
  ~80% of the ~4,300 a host shipped, and every instance repeats it against the same
  database, so 3 hosts is ~13,000 and a deploy's 6 hosts is far over 15,000. Since then
  `config.alloy` archives EVERY scrape (api, node, postgres, cadvisor, alloy) to S3, unfiltered,
  in parallel with Grafana, one folder per exporter:
  `s3://<logs-archive-bucket>/metrics/<api|node|postgres|cadvisor|alloy>/year=/month=/day=/hour=/`
  (OTLP JSON, one document per object, gzip, 5 min batches, 90 day expiry,
  `s3-logs-archive.tf`), so a Grafana blackout loses nothing. Postgres metrics go to S3
  ONLY (no `pg_*` series in Grafana; the dashboard has no DB-internals row; slow queries
  are also in RDS Performance Insights). The exporter has no retry in Alloy v1.18.1: a
  failed upload drops that batch (same as the log archive). Query the archive with SQL
  over the nested OTLP JSON (`unnest(resourceMetrics)` > `scopeMetrics` > `metrics` >
  `gauge|sum.dataPoints`, labels in `attributes`, time in `timeUnixNano`).
  Series budget in Grafana (api, node, cadvisor, alloy only): per host = ~314 + 5.6 x C, where C is the
  number of route x method x status combinations the API has served since it started (the latency
  histogram is trimmed in `config.alloy`'s `prometheus.relabel "api"`: buckets only for 2xx responses and
  only 0.1, 0.25, 0.5, 1, 2.5 s and +Inf; `_count`/`_sum` stay for every status; S3 keeps the full
  histogram). Without the trim it was ~314 + 14 x C. Hosts alive at once: 4 steady, 8 during a deploy
  at full size, up to 12 with retired hosts (they stay active ~20 min). At C = 150 that is about 1,150
  per host, so 12 hosts is ~13,800: count C from the S3 archive after real traffic. Percentiles from
  these buckets describe successful (2xx) requests only. Applying a change
  to `config.alloy` needs a `terraform apply` (the SSM copy, 8 KB cap, ~7.2 KB now) and
  a deploy: running hosts keep their old config until replaced.

## Scale capacity (more/fewer instances)

Within the existing 2–4 range, nothing to do for whichever color is
currently active — its target-tracking policy
(`aws_autoscaling_policy.request_count_tracking` in `asg.tf`, one per
color) already adds/removes instances on `ALBRequestCountPerTarget`
between 2 and 4. The **floor of 2 is load-bearing** (redundancy, not
cost-driven) and is enforced by `min_size`, which is runtime-managed by
`deploy.yml` on whichever color is active — see "Diagnose a failed
blue/green deploy" above if you ever see it drop below 2 unexpectedly.

To change the range itself (e.g. raise `max_size` past 4, change the
redundancy floor, or raise the `t3.medium` baseline), edit
`infra/terraform/asg.tf` (`min_size` / `desired_capacity` / `max_size` —
both colors' `for_each`-generated resources share the same expressions,
you're editing the formula, not a per-color value) or `instance_type` in
`variables.tf`, then:
```bash
pnpm infra:prod:init   # only needed once per terminal session / after switching envs
pnpm infra:prod:plan   # review the diff
pnpm infra:prod:apply  # applies infra/terraform/prod.tfplan
```
Opening a PR that touches `infra/**` also gets you the same plan for free as
a PR comment (`.github/workflows/terraform-plan.yml`) before you apply
locally.

## Database connection budget

The database (`db.t4g.small`) allows `max_connections` = memory / 9,531,392 = **181**; 3 are reserved for the
superuser, so about **178 are usable**. Every API server opens up to three pools:
`DATABASE_POOL_MAX` (requests) + `WORKER_POOL_MAX` (background jobs) + `ANALYTICS_POOL_MAX` (reports), plus one
connection for its Postgres exporter. A deployment runs the old and the new colour together (up to 4 + 4 = 8 servers).

- **Prod values** (SSM `/ocar/prod/api-env`): 8 + 6 + 2 = 16 per server (they were 15 + 10 + 4 = 29, which is 232 for
  8 servers, over the limit). 8 servers x 16 = 128, plus 8 exporters and 1 migration = about 137, 77% of 178.
- **Rule:** servers at the same time x (sum of the three caps + 1) + about 5 must stay under 80% of 178 (about 142).
  Raise a cap, or the maximum fleet size, only with that sum redone. Pools fill lazily and idle connections close
  after 30 s, so the real count follows load: the highest seen in the 2026-10-17 tests was 43 with 6 servers.
- **Watch:** dashboard panels "Database connections by pool" and "Waiting for a database connection"; Grafana alerts
  "Database connections high" (over 100 for 5 min), "Background job pool waiting" and "pg.Pool exhaustion".
  A pool that waits over 5 s errors, so sustained waiting means its cap is too low for the load.
- **Change a value:** edit the three keys in SSM `/ocar/prod/api-env`; servers read it when they boot, so it takes
  effect on the next deployment (or any server the autoscaler starts).
- **RDS Proxy** was considered and declined on 2026-10-18 (new cost and failure point; the session advisory lock in
  the report refresh and the connect-time statement timeout would pin connections). Revisit it if the fleet grows past
  4 servers per colour or pool waits show up under real load.

## Make any other infra change

Same three commands as above (`init` → `plan` → `apply`) for anything in
`infra/terraform/*.tf` — security groups, ALB listener rules, IAM, etc.
Always read the plan output before applying; nothing here auto-applies on
merge (only `terraform-plan.yml`'s PR-comment plan runs in CI — actual
`apply` is a deliberate local/manual step, by design, since AWS changes
aren't cheaply reversible the way an app deploy is).

## Check health / logs / metrics

- `GET https://ocar-api.clienttesting.in/health` — same check the ALB target
  group and deploy pipeline use.
- Grafana Cloud (Loki/Mimir/Tempo, shipped by the Alloy agent on each
  instance) — logs, `pg_pool_connections`, `http_request_duration_seconds`,
  `bullmq_queue_job_counts`, per-container CPU/memory (cAdvisor row on the
  `ocar-overview` dashboard), BullMQ queue depth.
- AWS Console → EC2 → Auto Scaling Groups → `ocar-prod-asg` (blue) or
  `ocar-prod-asg-green` (green) for instance count/health, or
  `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names
  ocar-prod-asg ocar-prod-asg-green`. Check `/ocar/prod/active-color`
  (SSM) first if you only care about the one actually serving traffic.
- The `Color` tag (`blue`/`green`) on every ASG/instance/target-group lets
  Grafana dashboards split metrics by color during a deploy.

## Archived logs (S3 + Athena, 6-month retention)

The `ocar_api` container's Pino lines are copied by Alloy to
`s3://ocar-prod-logs-archive/logs/year=…/month=…/day=…/hour=…/` (UTC, gzip,
5-minute batches, deleted after 190 days). Loki stays the live-debugging path.
Prod **metrics** are not archived to S3 — they live in Grafana Cloud only
(13 months on Pro; query via its Prometheus API).

- **Query:** Athena console → workgroup `ocar-prod-logs`, database
  `ocar_prod_logs`, table `app_logs` (one `line` column = raw JSON). Saved
  queries `app-logs-errors-today` / `app-logs-by-request-id`. **Always filter
  `year`/`month`/`day`**; the workgroup cancels queries scanning >10 GB.
  Access: attach the `logs_archive_reader_policy_arn` Terraform output to the
  person's IAM user/role.
- **Roll out a config change:** `terraform apply` updates the IAM role and the
  SSM `alloy-config`/`docker-compose-prod` copies, but running instances only
  read them at boot. Infra-only merges don't trigger a deploy, so after the
  apply run **Actions → Deploy → Run workflow** to roll a fresh color.
- **Verify after a deploy:** objects appear in the bucket within ~10 min;
  `docker logs ocar_alloy` shows no awss3/`stability` errors; the Athena
  "errors today" query returns rows.
- **If it breaks:** archiving failure never affects Loki or the API. A scrape
  over its `sample_limit` shows as `up == 0` for that job.
- **Alloy health:** the `ocar_alloy` container has a healthcheck on `/-/ready`
  (`docker ps` shows `healthy`). `deploy.yml` blocks cutover and rolls the
  idle color back if it isn't healthy. Grafana alerts (folder "Ocar Alerts",
  group `ocar-alloy-pipeline`): heartbeat lost, config load failed, unhealthy
  components, S3 archive failing, remote_write failing. Those alerts need
  `terraform apply` in `infra/terraform/observability/` (separate state).
- **Runtime health alerts** (group `ocar-runtime-health`, `alerts-runtime.tf`; they read
  series already shipped, so they add no active series): API p95 latency over 500 ms
  (warning) / 2 s (critical), 5xx over 2% on any route, an API server down, Node.js event
  loop p99 lag over 250 ms, host CPU over 85% for 10 m, host memory over 90%, a container
  OOM kill, requests per server per minute over 1,500 for 10 m (scale-out lagging or at the
  maximum size), queue backlog over 200 waiting jobs. "File descriptor exhaustion" watches
  the API process (`process_open_fds / process_max_fds`, over 80%), not the host-wide
  kernel maximum, which these servers report as effectively unlimited. "Active series
  usage" warns at 70% (early) and 85% of the 15,000 cap.

## Reports: digest did not arrive / Reports slow

Alert: **Admin daily digest not sent** (Grafana, `admin_digest_runs_total{result="sent"}`). The digest runs
at 09:00 IST from the API's scheduler queue and sends yesterday's numbers (5 KPIs to super/finance admins, 3 to ops).

1. `admin_digest_runs_total` by `result`: `failed` rising = a send or dedupe-key Redis error (check API logs for
   `admin digest send failed` / `admin digest dedupe check failed`); `skipped_duplicate` only = it already sent today.
2. Scheduler registered? `bullmq_queue_job_counts{queue="scheduler"}` and the log line `scheduler worker started`.
   The schedule is one `upsertJobScheduler('admin-daily-digest')` (09:00 `Asia/Kolkata`), safe to re-run on any instance.
3. Resend a day manually: delete the Redis keys `admin-digest:<YYYY-MM-DD>:finance` and `:ops` (set only after a
   successful send, TTL 48h); the next scheduler tick resends. Never delete them to "test" on a normal day: admins get a duplicate.

Reports slow or erroring: `pg_analytics_pool_connections{state="waiting"}` (dedicated pool, max `ANALYTICS_POOL_MAX`=4,
isolated from ride/payment traffic); `analytics_cache_requests_total{result="bypass"}` means Redis is unreachable
(Reports still works, just uncached). Ranges are capped at 366 days and answered from `idx_rides_requested_at` /
`idx_rides_completed_at_completed`. CSV exports are audited (`admin_audit_log.action = 'analytics_export'`).

Deploy-day note: Overview "revenue today" and completed count moved from `payments.created_at` / `requested_at` to the
ride `completed_at` clock (shared definitions in `api/src/modules/analytics/kpi-definitions.ts`), so rides that cross
midnight IST land on their completion day; expect a one-time shift versus yesterday's numbers.

## Releases and rollbacks (API + web + mobile)

**Order of a release:** push to `main` -> CI -> `Deploy` (API: migrations, blue/green, 10-minute
bake, automatic flip-back) -> `Deploy Web (Vercel)`. The web workflow runs only if CI passed and
the API deploy neither failed nor rolled back (`gate` job, `.github/scripts/web_release.py gate`),
so a site never ships against a backend that was rolled back. PRs get preview deployments only.
Manual run (Actions > Deploy Web (Vercel) > Run workflow, on `main`) deploys production without
the gate: use it only when you know the API is healthy.

**What rolls back automatically**
- API: failed health/smoke test (nothing user-facing changed) or 5xx during the bake -> traffic flips back to the old color.
- Web: after a production deploy the workflow promotes it, waits until it is the live production
  deployment, then checks the live domain (pages load, no baked `[SENSITIVE]` placeholder, prod API
  address present, `/health` ok). On failure it runs `vercel rollback <previous deployment>` (Pro
  plan: any earlier production deployment) and the job fails. After a rollback Vercel stops
  auto-assigning domains to new deployments; the next production deploy runs `vercel promote`, which
  re-enables it. Manual rollback: Vercel dashboard > project > Deployments > Instant Rollback.
- Mobile apps: nothing rolls back (installed builds stay in use). The API must therefore stay
  compatible with old app versions; `mobile_payments_enabled` is the kill switch for in-app payments.

**What does NOT roll back: the database.** Migrations run before the traffic flip and are never
undone, so after a flip-back the old API runs against the new schema. Rules (expand/contract):
1. Ship additive changes first (new nullable column / new table / new index / new endpoint). Old code must keep working with them.
2. Never drop, rename or change the type of something the previous release still reads or writes in the same release as the code change. Remove it in a later release, after the bake window and after old app versions are retired.
3. Backfills run as separate jobs, not inside the release migration.
4. New endpoints and response fields are additive; do not change or remove existing ones while old web/mobile builds exist.

**Enforced in CI.** The `Migration safety` job (pull requests, `.github/scripts/migration_check.py`)
fails a PR that edits, renames or deletes an existing migration (the runner skips files it already ran,
so such an edit never reaches existing databases), reuses a migration number, or adds a statement that
breaks the previous release: DROP TABLE/COLUMN/TYPE, RENAME, ALTER COLUMN TYPE, SET NOT NULL, ADD COLUMN
NOT NULL without DEFAULT, TRUNCATE, DELETE/UPDATE without WHERE, UPDATE cities.boundary, UPDATE rate_cards.
A reviewed exception goes in the file, with a reason on the same line:
`-- migration-check: allow drop-column no reader since release 2026-09, backfill done in 104`.

**API smoke test before the traffic flip** (`.github/scripts/api_smoke.py`, run by the Deploy workflow
against the idle color): health (db + redis), a public read, request validation, auth middleware on
wallet/rides/admin, and the PayU money routes (SDK signer + confirm, return redirect, webhook ack). Ten
harmless calls; any failure rolls the idle color back with nothing user-facing changed. Add a check there
when you add a route whose absence would be a silent outage.

## Web deploys (Vercel, admin / driver / user): setup

The three web apps deploy from GitHub Actions (`.github/workflows/deploy-web.yml`), not from
Vercel's Git integration: Vercel blocks every deployment it builds itself when the commit author is
not a seat on the team (single-seat plan, pushes come from another account), so each app's
`vercel.json` sets `git.deploymentEnabled: false` and the workflow builds on the runner and uploads
the result (`--prebuilt`, which is not subject to that check).

- **Secrets** (repo Actions secrets): `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_ADMIN`, `VERCEL_PROJECT_ID_DRIVER`, `VERCEL_PROJECT_ID_USER`, and `WEB_ENV_ADMIN` / `WEB_ENV_DRIVER` / `WEB_ENV_USER` (each app's public `NEXT_PUBLIC_*` / `VITE_*` settings as a dotenv block). The Vercel projects keep those settings as Sensitive, which `vercel pull` cannot read (it returns the text `[SENSITIVE]`), so the workflow overrides them from these secrets; a guard fails the job if the placeholder is still in the build. To change a public setting, update the matching `WEB_ENV_*` secret (and Vercel, for consistency) and re-run the workflow.
- **Rotate the token:** create a new one at vercel.com/account/tokens (scope = the team), update `VERCEL_TOKEN`, delete the old one.

## Rotate a secret (DB URL, JWT secret, Razorpay keys, etc.)

All of it lives in one SSM `SecureString` parameter, `/ocar/prod/api-env` —
there's no Terraform resource for it (`iam.tf` only grants read access, it's
never created by `apply`). To change one value you must pull the whole
blob, edit it, and push the whole thing back (this is the exact ergonomic
pain flagged in `CLAUDE.md`'s "Pending Ops Actions" as a candidate for a
proper secrets manager later):
```bash
aws ssm get-parameter --name /ocar/prod/api-env --with-decryption \
  --query 'Parameter.Value' --output text > api-env.txt
# edit api-env.txt by hand
aws ssm put-parameter --name /ocar/prod/api-env --type SecureString \
  --value "$(cat api-env.txt)" --overwrite
rm api-env.txt   # don't leave decrypted secrets on disk
```
Then roll whichever color currently has running instances so they pick it
up (they only read SSM at boot) — normally just the active one, since the
idle color sits at 0 instances between deploys:
```bash
ACTIVE=$(aws ssm get-parameter --name /ocar/prod/active-color --query 'Parameter.Value' --output text)
ACTIVE_ASG=$([ "$ACTIVE" = "blue" ] && echo "ocar-prod-asg" || echo "ocar-prod-asg-green")
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name "$ACTIVE_ASG" \
  --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":100}'
```

## PayU collections

PayU collects ride fares, driver wallet top-ups and package purchases
(design: `docs/superpowers/specs/2026-10-06-payu-collections-migration-design.md`).
Razorpay/RazorpayX stays for driver payouts — keep its keys.

**Required env** (in the `api-env` SSM blob, `/ocar/{prod,staging}/api-env`):

| Key | Value |
|---|---|
| `PAYU_KEY`, `PAYU_SALT` | from the PayU dashboard; test and live are different pairs |
| `PAYU_ENV` | `prod` for live keys, `test` for sandbox keys (selects the PayU endpoints) |
| `API_BASE_URL` | public https API origin — PayU posts the browser back to `<API_BASE_URL>/api/v1/payments/payu/return` (verify it; it used to be unused in prod) |
| `USER_APP_URL` | public https rider portal origin (ride receipt redirect) |
| `DRIVER_APP_URL` | public https driver portal origin (wallet / package redirect) |

**The API refuses to boot in production** if `PAYU_KEY`/`PAYU_SALT` is empty
or any of the three URLs is not `https://` or points at localhost. So secrets
go in **before** the image: a deploy without them fails the idle color's
health check and never takes traffic (safe, but the deploy fails).

1. Pull, edit, push the whole blob (same as "Rotate a secret" above; staging:
   `/ocar/staging/api-env`):
   ```bash
   aws ssm get-parameter --name /ocar/prod/api-env --with-decryption \
     --query 'Parameter.Value' --output text > api-env.txt
   # add PAYU_KEY, PAYU_SALT, PAYU_ENV, USER_APP_URL, DRIVER_APP_URL; verify API_BASE_URL
   aws ssm put-parameter --name /ocar/prod/api-env --type SecureString \
     --value "$(cat api-env.txt)" --overwrite
   rm api-env.txt
   ```
2. Then deploy the image tag (normal merge-to-`main` deploy, or the `Deploy`
   workflow for staging). New instances read SSM at boot.
3. PayU dashboard → Developers → Webhooks → Create Webhook → URL
   `https://<api>/api/v1/payments/webhook/payu`, events **Successful**,
   **Failed**, **Refund**, **Dispute** (refund/dispute are acknowledged and
   logged only, never acted on). Do it in test mode first for staging.

**Razorpay drain window.** Riders who opened a Razorpay checkout just before
the cutover can still pay it afterwards. The 30-minute Redis order binding
only limits `/payment/verify`; `/webhook/razorpay` and the Razorpay branch of
the reconcile sweep still confirm a late capture with no time limit. So keep
the Razorpay keys and Razorpay webhook in place, and don't treat the cutover
as done (or remove anything Razorpay-side), until this drain query returns no
rows:
```sql
SELECT ride_id, status, updated_at FROM payments
WHERE status = 'pending'
  AND razorpay_order_id IS NOT NULL
  AND gateway IS DISTINCT FROM 'payu'
ORDER BY updated_at;
```

### Missed PayU webhooks (reconcile sweep)

Every payment-reconcile worker run also sweeps pending PayU package purchases
(`package_purchase_orders`) and wallet top-ups (`wallet_topup_orders`, a
durable row written when the order is created) aged 10 minutes to 3 days, and
re-runs each through `verify_payment`: captured → credited once (same
idempotent path as the webhook); pending/failed/unknown → row left as is. Rows
older than 3 days are not polled and never auto-failed. Find stuck ones and
check each txnid in the PayU dashboard:
```sql
SELECT * FROM wallet_topup_orders
WHERE status = 'pending' AND created_at < now() - interval '3 days';
SELECT * FROM package_purchase_orders
WHERE gateway = 'payu' AND status = 'pending' AND created_at < now() - interval '3 days';
```

### Driver app in-app payments (PayU native SDK)

The driver app pays through PayU's native sheet. Server pieces: `client: 'sdk'` on
`POST /payments/wallet/driver/topup/order` and `/payments/packages/purchase/order`,
`POST /payments/payu/sdk-hash` (validating signer) and `POST /payments/payu/confirm`.

**Kill switch** (default OFF; both order creation and hash signing refuse with 403 while off; `confirm` keeps
working so in-flight payments always resolve). Admin portal: Config > System config > Payments & fees > "Driver app payments (PayU)" (super admin; migration 115 creates the row, off). Or flip it in SQL:

```sql
INSERT INTO system_config (key, value, description)
VALUES ('mobile_payments_enabled', 'true', 'Driver app native PayU payments')
ON CONFLICT (key) DO UPDATE SET value = 'true';   -- set 'false' to switch off
```

Config reads are cached for a few minutes (`CONFIG_CACHE_TTL_SECONDS`); expect the change to apply within that window.

**Rollout order:** ship the app with the flag off → enable for internal drivers on **test keys** (`PAYU_ENV=test`, EAS
`preview`/`development` builds) → switch to live keys + `PAYU_ENV=prod` and use a **production** EAS build (it is
built with `EXPO_PUBLIC_PAYU_ENV=prod`; a build and server on different environments refuse to open the sheet) → one
small live ₹ UPI payment on a real phone (UPI intent cannot be tested in PayU test mode) → enable for everyone → only
then restore `driver_minimum_balance` to 500.

**Support:** a driver who paid but sees no credit: the app resumes unresolved payments on next launch, the webhook
and the 5-minute sweep credit them anyway. Check `wallet_topup_orders` / `package_purchase_orders` by `gateway_txn_id`
and `payment_gateway_events`. Signer rejections show up as 400s on `/payu/sdk-hash`; an SDK that asks for a hash name
we do not allow-list (new SDK version) fails payments — see `payu-sdk.ts` before widening the allow-list.

### Unattributed PayU captures

Money PayU captured that the API did not credit increments
`payu_unattributed_captures_total{reason}`:

| `reason` | Meaning |
|---|---|
| `unknown_txn` | capture for a txnid we can't map (e.g. a superseded ride retry txn) |
| `amount_mismatch` | captured amount differs from what we stored — not confirmed |
| `duplicate_capture` | ride payment already settled by a different payment (rider paid twice) |
| `confirm_lost_race` | ride payment re-failed between revive and confirm |

Note: an `amount_mismatch` row stays `pending`, so the reconcile sweep
re-increments the counter for it on every run until someone resolves it by hand.
That includes wallet top-up and package purchase mismatches: they are
re-checked every 5-minute sweep for up to 3 days, so the
`increase(...[10m]) > 0` alert below keeps firing until the row is resolved.

**Alert:** create by hand in Grafana Cloud (not in Terraform):
`increase(payu_unattributed_captures_total[10m]) > 0`.

Each one also leaves an unprocessed audit row (txnid, mihpayid, amount — no
card data):
```sql
SELECT id, event_type, gateway_event_id, payload, created_at
FROM payment_gateway_events
WHERE processed = false AND gateway_event_id IS NOT NULL
ORDER BY created_at DESC;
```
Action: look up the `mihpayid` in the PayU dashboard. Refund it there
manually (duplicate / unknown / wrong amount), or, if it clearly belongs to a
pending payment, attribute it by hand and record what you did. The API never
guesses an owner.

## Updating an observability secret (Grafana Cloud alerting/SLO/synthetics)

`infra/terraform/observability/` (alert rules, SLOs, synthetic monitoring —
one account-wide Grafana Cloud stack, applied locally, not from CI) reads
every credential/config value it needs from SSM under
`/ocar/observability/*` — never from a local `.tfvars` file or `TF_VAR_*`
env vars (a laptop-only tfvars file for this module got lost once already,
2026-08-19, which is exactly the single point of failure this avoids).

To change one (e.g. rotating the Grafana Service Account token):
```bash
aws ssm put-parameter --name /ocar/observability/grafana-auth \
  --type SecureString --value "<new-value>" --overwrite
```
Same pattern for the other 8 parameters (`grafana-url`, `slack-webhook-url`,
`alert-email`, `prometheus-datasource-uid`, `synthetic-probe-ids` —
comma-separated numbers, e.g. `"39,44"`, `sm-access-token`, `sm-url`,
`usage-insights-datasource-uid`) — use `--type String` for the non-secret
ones. No instance refresh needed (Terraform reads SSM live at `plan`/`apply`
time, unlike the boot-time-only params in `/ocar/prod/*`). Then:
```bash
cd infra/terraform/observability
terraform plan   # no -var/-var-file needed, ever
terraform apply
```

## Stand up / tear down staging (load-test environment)

Full manual-step runbook already written:
`docs/superpowers/specs/2026-08-14-staging-runbook.md`. Short version:
`.github/workflows/staging-infra.yml` (`workflow_dispatch`, choose `apply`
or `destroy`), or locally: `pnpm infra:staging:init/plan/apply/destroy`.
**Always destroy after a load test** — staging isn't meant to run
continuously and costs the same per-instance rate as prod.

`terraform apply` only boots the ASGs against whatever image tag is already
sitting in `/ocar/staging/{blue,green}/image-tag` — it does not deploy code.
To get a real app version onto staging, run the `Deploy` workflow manually
(`workflow_dispatch`, `environment: staging`) — it runs the same blue/green
cutover (build, migrate, scale idle color, smoke-test, flip, bake) as prod.
One-time SSM bootstrap is required before the first-ever staging deploy —
see the runbook's "Bootstrap the blue/green SSM parameters" section.

## Who can do what (current gaps — see CLAUDE.md "Pending Ops Actions")

- Deploys to `main` currently run with **no human approval gate** — the
  `production` GitHub Environment referenced in `deploy.yml` doesn't exist
  yet, so it's inert. Needs repo admin to create it.
- Same gap on the `staging` environment for `staging-infra.yml` — a
  `destroy` dispatch has no confirmation step today.
- No branch protection on `main` — a direct push bypasses PR review
  entirely (CI still has to pass before *deploy*, but not before *merge*).

Whoever has GitHub org/repo admin rights should close these before treating
this pipeline as fully production-hardened — exact `gh api` commands are in
`CLAUDE.md`.
