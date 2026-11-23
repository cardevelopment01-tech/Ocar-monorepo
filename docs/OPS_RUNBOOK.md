# Ops Runbook — Production Infra

Practical "how do I do X" reference for operating the prod fleet. For the
architecture rationale (why ASG/ALB, why no NAT gateway, why local state
originally, etc.) see `docs/TERRAFORM_INFRA_BRIEF.md`. For standing up
staging, see `docs/superpowers/specs/2026-08-14-staging-runbook.md`.

There is more than one environment (`prod`, the new `prd`, old `staging`). Which
commands to run for which one, and the safety guard around them, is in
`docs/INFRA_ENVIRONMENTS.md` — read that first. Commands below are for `prod`.

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

# Bring the target color back up if it had already been scaled to 0 (harmless no-op if it's still at 1)
aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$IDLE_ASG" --min-size 1 --desired-capacity 1

# Wait until it's healthy before flipping -- poll this until targets show "healthy"
IDLE_TG_ARN=$(aws elbv2 describe-target-groups --names "$IDLE_TG" --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 describe-target-health --target-group-arn "$IDLE_TG_ARN"

# Flip the listener
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn \
  "$(aws elbv2 describe-load-balancers --names ocar-prod-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)" \
  --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text)
aws elbv2 modify-listener --listener-arn "$LISTENER_ARN" --default-actions "Type=forward,TargetGroupArn=$IDLE_TG_ARN"
aws ssm put-parameter --name /ocar/prod/active-color --type String --value "$IDLE" --overwrite

# Restore the minimum on the color that's now live, drop it on the one going idle
aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$IDLE_ASG" --min-size 1
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
- **The live color quietly drops to 0 instances during a quiet
  traffic period, with no deploy running.** The minimum
  (`min_size=1` on whichever color is active) is runtime-managed by
  `deploy.yml`, not Terraform — if `asg.tf`'s `lifecycle.ignore_changes`
  ever loses `min_size` (e.g. someone "simplifies" it), the next
  unrelated `terraform apply` silently resets it to 0, and the
  pre-existing request-count-tracking policy is then free to scale the
  live color down with nothing stopping it. Check
  `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names
  ocar-prod-asg ocar-prod-asg-green --query 'AutoScalingGroups[].{Name:AutoScalingGroupName,Min:MinSize,Desired:DesiredCapacity}'`
  — whichever is currently active per `/ocar/prod/active-color` should
  always show `Min: 1`.
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
  Series budget in Grafana (api, node, cadvisor, alloy only): per server = ~283 fixed series + ~5.6 x C, where C is
  the number of route x method x status combinations the API has served since it started, plus ~105 series that do
  not come from the servers (mostly the synthetic-monitoring probe `ocar-api-health`, 79). The latency histogram is
  trimmed in `config.alloy`'s `prometheus.relabel "api"` (buckets only for 2xx responses and only 0.1, 0.25, 0.5, 1,
  2.5 s and +Inf; `_count`/`_sum` stay for every status; S3 keeps the full histogram): measured 4.3 series per
  combination against 14 untrimmed (5.6 is the conservative figure). Measured in Grafana on 2026-10-18: 444 active
  series in total (3% of the 15,000 cap): 339 on the one server (API 223, node 77, containers 25, Alloy 14) at C = 13.
  Hosts alive at once: 4 steady, 8 during a deploy at full size, up to 12 with retired hosts (they stay active ~20
  min). The cap is reached at about C = 170 with 12 hosts, 280 with 8, 610 with 4 (untrimmed: 68, 112, 245). Read the
  real numbers any time: `grafanacloud_instance_active_series` in the `grafanacloud-usage` datasource, and
  `count by (host) ({__name__=~".+"})`; count C from the S3 archive after real traffic. Percentiles from
  these buckets describe successful (2xx) requests only. Applying a change
  to `config.alloy` needs a `terraform apply` (the SSM copy, 8 KB cap, ~7.2 KB now) and
  a deploy: running hosts keep their old config until replaced.

## Scale capacity (more/fewer instances)

Within the existing 2–4 range, nothing to do for whichever color is
currently active — its target-tracking policy
(`aws_autoscaling_policy.request_count_tracking` in `asg.tf`, one per
color) already adds/removes instances on `ALBRequestCountPerTarget`
between 1 and 4. The **minimum is 1** (owner decision 2026-10-18: one server
while traffic is small, to be raised gradually as it grows). It is enforced by
`min_size`, which is runtime-managed by `deploy.yml` on whichever color is
active — see "Diagnose a failed blue/green deploy" above if you ever see it
drop to 0 unexpectedly. Trade-off, from the 2026-10-17 load tests: with one
server there is no redundancy and a sudden jump in load has nothing to share
it for the 5 minutes the autoscaler needs (p95 reached 2 s for a minute, no
errors). Moving the minimum to 2 across two Availability Zones removes most
of that and costs one more `t3.medium`.

How a color scales out (one policy on each color's ASG, `asg.tf`, `request_count_tracking`; the name is historical):

- **Average CPU only.** Target tracking on `ASGAverageCPUUtilization`, target `asg_cpu_target_percent` (prd 19, stg 20). There is
  no request-based rule in any environment: a request-count or request-burst rule can add servers while the CPU is idle
  (a freshly started server tripped one in stg on 2026-10-30). AWS manages the alarms of a target tracking policy and they
  cannot be tuned. Scale-in (after about 15 quiet minutes) is done by this policy too.
- **Metric resolution:** prd has detailed monitoring on (1-minute CPU); stg does not (5-minute CPU), so stg reacts more slowly.
- **Cold start:** a server that has just booted (image pull, migrations) can lift average CPU above the target and make the group
  add one more server; it scales back in by itself.
- **Idle color:** has no targets; `deploy.yml` suspends `AlarmNotification` on it, which also silences its CPU alarm until the cutover.
- **Test it:** `k6 run` a load against the API and watch
  `aws autoscaling describe-scaling-activities --auto-scaling-group-name <active asg> --max-items 3`; the launch cause names the
  `TargetTracking-...-AlarmHigh` alarm.

To change the range itself (e.g. raise `max_size` past 4, change the
redundancy floor, or raise the `t3.medium` baseline), edit
`infra/terraform/asg.tf` (`min_size` / `desired_capacity` / `max_size` —
both colors' `for_each`-generated resources share the same expressions,
you're editing the formula, not a per-color value) or `instance_type` in
`variables.tf`, then:
```bash
pnpm infra:prd:init   # only needed once per terminal session / after switching envs
pnpm infra:prd:plan   # review the diff
pnpm infra:prd:apply  # re-checks the plan file, then asks you to type `apply prd`
```
(Staging has the same commands as `infra:stg:*`; see `docs/STG_ENVIRONMENT.md`. The old `prod` stack no longer exists.)
Opening a PR that touches `infra/**` also gets you the same plan for free as
a PR comment (`.github/workflows/terraform-plan.yml`) before you apply
locally.

## Graceful socket drain (deploys and scale-in)

When a server is removed, the load balancer keeps its WebSockets open until the deregistration delay (300 s) ends and
then closes ALL of them in the same instant, so every user on that server reconnects together (measured 2026-10: about
720 new connections in one minute against a normal 20-30). Draining closes them one by one, in random order, over
`SOCKET_DRAIN_SECONDS` (default 90) before that cut-off; each client reconnects by itself and recovers its session.

- **Deploys:** the step "Drain the old color's sockets gradually before scaling it down" in `deploy.yml` sends `SIGUSR2`
  to `ocar_api` on every old-color instance after a clean bake, then waits `DRAIN_SECONDS + 15` s before the scale-down.
  `DRAIN_SECONDS` there must match `SOCKET_DRAIN_SECONDS` (`api/src/config/index.ts`), and stay well under 300. The step is
  best effort (`continue-on-error`): if it cannot run, the scale-down behaves exactly as before.
- **Autoscaler scale-in and any other termination:** in production the API watches its instance's Auto Scaling target
  lifecycle state (IMDSv2, `api/src/websocket/termination-watcher.ts`) and starts the same drain when it becomes
  `Terminated`. AWS does not document whether that happens before or after the load balancer starts draining, so the
  API logs the moment it sees it (`instance target lifecycle state`). **Measured in production on 2026-10-18** (three
  autoscaler scale-ins after a load test): the state became `Terminated` and the watcher saw it 11 to 14 seconds after
  the scaling activity started, and the load balancer's drain finished 5.7 minutes after that, so the drain starts at the
  beginning of the 300 s window with the whole window available. Those three servers had no sockets connected, so the
  drain logged `total: 0`; a drain of live sockets on a real scale-in is not yet observed (read `socket drain started` /
  `socket drain finished` in the logs). The `SIGTERM` log line (`shutting down gracefully`) comes at the end of the load
  balancer's drain, about 5 minutes later. Turn the watcher off with `DRAIN_ON_TERMINATION=false` in SSM `/ocar/prod/api-env`.
- **How a socket is closed matters:** `socket.conn.close()` (the transport) makes the client reconnect by itself and
  recover; `socket.disconnect(true)` makes it report "io server disconnect" and NOT reconnect. A draining server also must
  not refuse connections from a middleware (a refused client does not retry), so a late arrival is accepted and closed.
- **Manual drain of one server:** `docker kill --signal=SIGUSR2 ocar_api` on the instance (through SSM). Look for
  `socket drain started` and `socket drain finished` in `docker logs ocar_api`.
- **Not covered:** `docker stop`/`SIGTERM` (an instance shutting down) still closes every socket at once within 10 s.

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

Same flow as above (`init` → `plan` → a deliberate, approved manual `apply`) for anything in
`infra/terraform/*.tf` — security groups, ALB listener rules, IAM, etc.
Always read the plan output before applying; nothing here auto-applies on
merge (only `terraform-plan.yml`'s PR-comment plan runs in CI — actual
`apply` is a deliberate local/manual step, by design, since AWS changes
aren't cheaply reversible the way an app deploy is).

## Check health / logs / metrics

- `GET https://api.ocarindia.com/health` — same check the ALB target
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

## A driver or rider says "I never got the OTP"

SMS goes out through BulkSMSPlans (`api/src/providers/sms.provider.ts`). A send is "sent" in our data as soon as the vendor accepts it, so
a message the vendor accepted but an operator or DLT filter dropped still looks sent. What we keep, per send:

- `notification_logs.provider_response` holds the vendor's reply (code, message and any message id), with anything that echoes the SMS text removed so an OTP is never stored.
  `failure_reason` holds the vendor's message or "SMS provider returned a non-JSON reply (HTTP n)" for a failed send.
- One log line per send: `event: "sms.sent"` (accepted) or `"sms.rejected"`, with `phone_tail` (last 4 digits), `template_id`, `http_status`, and the vendor's fields under `provider`.
  Query them in Athena (`app_logs`, filter `year/month/day` first): `json_extract_scalar(line,'$.event') IN ('sms.sent','sms.rejected')`.

To tell "we never sent it" from "sent, not delivered": find the request (`auth.otp.request`, `phone_tail`), then the `sms.sent` line a moment later, then take the vendor's
message id from it to the BulkSMSPlans delivery report. No `sms.sent` line and a `notifications job failed` or `sms.rejected` line means we failed (balance, bad template, vendor down).
`sms.sent` present and nothing on the phone means delivery: check the vendor's delivery report, the DLT template (`BULKSMSPLANS_OTP_TEMPLATE_ID`) and sender ID approval, balance, and the phone's operator.

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

> Use `pnpm env:edit <env>` (see `docs/INFRA_ENVIRONMENTS.md`, "Editing API settings"). It does the pull, the edit, a masked diff,
> a version check and the push for you. The manual commands below are the same steps by hand.

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

## Database password rotation (managed RDS master password)

The RDS master password (`ocar_admin`) is created and rotated every 7 days by AWS (`manage_master_user_password` in `rds.tf`;
secret `rds!db-...` in Secrets Manager). A rotation changes the password in place: open connections keep working, **new**
connections that present the old one are refused with Postgres `28P01`. The first rotation on prd (5 Nov 2026, 04:09 UTC) did
exactly that: the API's cached password was the old one and every call that needed a new connection
returned 500 until the cache expired. Same class as `docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md`.

**Setup (already in place on prd):** `/ocar/prd/api-env` has `DB_AUTH_MODE=secrets-manager` and no `DATABASE_URL`. `user_data.sh.tpl`
derives `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_SECRET_ARN` from RDS at boot, so there is no copied password to go stale. The instance role
can read the secret (`rds_secret_read`, `iam.tf`). A new environment must set `DB_AUTH_MODE=secrets-manager` in its api-env the same way.

**How the API survives a rotation:** it reads the secret on each new connection with a 15 s cache (it was 5 min, which left up to 5 minutes
of refused new connections after each rotation) and, on `28P01`, forgets the cache and retries once, so callers see nothing. Test on
**stg first**: `aws secretsmanager rotate-secret --secret-id <stg secret arn>` (changes stg only), then confirm no 5xx and no `28P01`.
Never `rds_iam` on `ocar_admin`.

**If "Database password rejected" (alert) or `28P01` persists past a minute:** check `DB_AUTH_MODE` in api-env. If the env still uses a
copied `DATABASE_URL`, put the current secret's password in it (`pnpm env:edit <env>`) and roll the active color.

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

## Offers and coupons

Design: `docs/superpowers/plans/2026-11-03-offers-and-coupons.md`. Money model: the rider pays the post-offer amount, the
driver is paid that same amount (not the gross fare), and no commission is taken while `commission_percent` is 0. Offers
only apply while `commission_percent` is 0 and never in package-billing cities, so restoring commission by hand stops new
offers on its own. The commission holiday itself is switched on and off manually.

**Switches** (`system_config`, Admin > Config; all default `'false'`):

| Key | Effect |
|---|---|
| `offers_enabled` | Master switch. Off: preview answers `enabled:false`, the apps hide every coupon row, booking ignores offers. |
| `offers_cash_discounts_enabled` | Lets cash rides get a discount. Saving it `true` is refused (422 `CASH_DISCOUNT_GUARD`) until the guard conditions hold; read the message. |
| `offers_cash_guard_enforced` | Default `'true'`. Set `'false'` to lift the cash-discount driver-version guard for internal testing before the cash_due driver build (1.2.0) is in production. While lifted, a discounted cash ride reaching a driver on an older app shows that driver the undiscounted fare. Put it back to `'true'` (refused while cash discounts are on and the driver minimum is still low) before the public launch. |
| `offers_cashback_enabled` | Cashback benefits. Leave off until riders can spend wallet credit. |
| `offers_max_discount_percent` | Hard cap on any discount as a percent of the fare (default 15). |

**Go-live order:** staging soak -> prod `offers_enabled=true` with cash discounts still off -> raise the driver app minimum
version (`app_update_driver_android_min`) once the driver release that understands discounted fares is out -> only then
`offers_cash_discounts_enabled=true`. Cashback last.

**Kill switch:** set `offers_enabled` to `'false'`. In-flight reservations are released by the sweep (below); rides already
booked keep their discount.

**Metrics** (Grafana, `offers_*`):
- `offers_redemptions_total{status}` - reserved / consumed / released / reversed.
- `offers_preview_rejections_total{reason}` and `offers_reserve_refused_total{reason}` - spikes in `BUDGET_EXHAUSTED` or
  `DISABLED` mean an offer ran out or was ended while riders still see it.
- `offers_budget_remaining{offer}` - burn rate per offer.

**Stuck reservations:** the `sweep_offer_reservations` job releases reservations whose ride never settled; `sweep_offer_expiry`
ends offers past their end date. If an offer's budget looks too low, check for `reserved` rows older than the sweep window in
`offer_redemptions` before raising the budget.

**Changing an offer mid-flight:** edit through Admin > Offers (creates a new version; riders with the old price get a 409
`PRICE_CHANGED` and see the new price, nothing is re-booked automatically).

## A driver says "a document was rejected" and cannot go online

To find every driver in this state at once, open **Drivers -> Blocked by docs**: active drivers a document keeps offline, each with the reason next to the status (for example `Insurance expired +1`; hover for the full text). The count on the tab is the number of such drivers. Then open one driver's profile (Drivers -> the driver). Red chips under the name list every document that blocks them and why, for example `Can't go online: Insurance expired on 30 Oct 2026`. The same list is what the driver sees in the app (Home banner, the Documents screen, and the error when they tap Go online). The four reasons:

- **Expired**: the document is approved but its valid-until date has passed. This is the one that looks fine on the card (it used to read "approved"); it now reads "Expired <date>" in red. The driver uploads a renewed copy; approve it with the new valid-until date. Any approved vehicle document counts, including the optional pollution (PUC) and fitness certificates.
- **Rejected**: a reviewer rejected it. The note says why.
- **Waiting for review**: a required document was uploaded and is still pending. Review it in the same profile.
- **Missing**: an RC front with no RC back. The driver uploads the back.

The list comes from one server rule (`api/src/modules/drivers/doc-issues.ts`, same rule as the dispatch gate `docIssueExistsSql`; `tests/integration/doc-issues-vs-gate.test.ts` checks the two agree). No developer is needed to find the reason. Raw check, read-only: `docIssueExistsSql` in `drivers.repository.ts`.

## Broadcasts: send a notice, and see what happened to it

Admin -> **Broadcasts** (super admin and ops admin). Pick drivers or riders, narrow them down if you want (city, vehicle type, "blocked by a document", "missing the RC back", riders who booked recently), write the title and message, and **Check audience** first: it shows how many people will be notified, how many of them also get the push on their phone (a phone seen in the last 30 days), how many get the in-app notification only, and who was left out and why. Sending to more than 10 people asks for a confirmation. A send cannot be recalled.

- **Test first.** Tick "Specific phone numbers only" and type your own number (up to 10). Those sends are not counted against the daily limit. The check lists who each number belongs to (name and driver code), so a mistyped number is caught before you send.
- **Daily limit applies to offers only.** A person gets at most 2 offers in any 24 hours (`BROADCAST_DAILY_CAP_PER_PERSON` in `api/src/constants/limits.ts`). Anyone over it is left out of an offer and counted under "Left out". **Announcements are never limited**, so an urgent notice always goes out, and they do not use up a person's offers. Sends to typed phone numbers never count. Offers are only allowed 10:00-21:00 IST: an offer whose retry lands after 21:00 stops, and the history shows "Failed" with the reason and how many it reached out of how many it was meant for.
- **Sent broadcasts** (below the form) updates itself for a couple of minutes after a send. Columns: *Notified* = an in-app notification was created; *Pushed* = Firebase accepted the push for at least one of their phones (not proof they saw it); *In-app only* = no registered phone, or the result is still arriving (marked *); *Refused* = Firebase rejected every phone (invalid phones are removed from our list); *Opened* = the person tapped the push, or opened it in the driver app's notification list (both apps mark it read on a tap; an app version from before this change does not, so those taps are not counted); *Left out* = switched this type off, or over the daily limit (at the check, or by the time it was sent: the check is a snapshot, so someone may have used up their limit on another broadcast in between). A row marked *before tracking* was sent by an older release that kept no per-person records: only how many it went to is known, and the other columns show a dash.
- **Size.** Built and measured for about 100,000 people in one send: roughly 100 seconds, about 1,000 people a second, 201 Firebase calls (people are sent in groups of 500, one database statement and one Firebase call per group), nothing queued per person and no extra Redis memory. The earlier one-job-per-person design took about 4.6 minutes just to queue 100,000 pushes and put all of them in the same queue as "driver arrived" pushes. Knobs in `api/src/constants/limits.ts`: `BROADCAST_CHUNK_SIZE` (500 = Firebase's limit per call) and `BROADCAST_CHUNK_PAUSE_MS` (250 = the ramp; lower it to go faster, raise it to be gentler on Firebase's 600,000 per minute shared limit). A send reads all its recipient ids into memory first (fine to about 1 million).
- **Firebase trouble.** A group whose Firebase call fails for a reason a retry can fix is retried for just those phones, 3 times in all, pausing longer each time. After that the person shows as *Refused* with reason `fcm_unavailable` in `notification_logs.failure_reason`.
- **No live toast for broadcasts.** A broadcast no longer sends a live socket update to each connected app (that was a Redis write per person). The push is the alert, and the app's notification list refreshes when it is opened.
- **Riders:** the rider app has no notification list (by design: ride updates live on the ride and Trips screens), so a rider with no registered phone does not see a broadcast at all. The preview warns about this.
- **Picture and tap screen (optional).** *Picture*: an `https://` link, shown large in the Android notification (a wide 2:1 picture under 1 MB works best); the form previews it and refuses anything that is not https, because Firebase rejects a malformed picture link for the whole message. The picture is fetched by the phone, so the link must stay up while people may still receive it. *When they tap it*: a screen key, never a path. Riders: home, offers, trips. Drivers: home, wallet, earnings, documents (`BROADCAST_LINKS` in `broadcast.service.ts`; the apps map each key to a route in `pushRouting.ts`). With none chosen a tap opens the app (drivers land on their notification list). An app that does not know a key just opens the app. Action buttons are not supported: they need the app to build the notification itself instead of the system doing it.
- **If a send stops part way** (a deploy or a crash), it is retried automatically and only notifies people who have not been notified yet; nobody gets it twice. Status *Failed* means every retry failed: check the API logs for `broadcast:`.
- **Deploying migrations 145-147.** Measured on a laptop copy with 3 million `notification_logs` rows (1.2 GB): 145 is instant; 146 (linking old rows) took about 32 s with a handful of old broadcasts, mostly one scan of the table (no index to narrow it), and only locks the rows it links; 147 (the unique index) took about 7 s and makes writes to `notification_logs` wait for that long (ride-event notifications, in-app feed). Check the row count on prd first (about 10 s of 145 per million rows) and deploy at a quiet hour. The runner wraps each file in a transaction, so `CREATE INDEX CONCURRENTLY` is not available.
- **Sending the same broadcast twice.** The same title, text, type and audience from the same admin within 2 minutes is refused (409), so a double click or a retried request cannot notify everyone twice. A send to typed phone numbers is exempt.
- **Broadcasts sent before tracking** (migrations 145-147) keep their real results: the old release recorded each person's push result on their notification row, and 146 links those rows to their broadcast by owner kind, type, title and text within 2 hours. Verified on a copy of the data: pushed, refused, in-app only and opened all matched. One limit: if the same text was sent twice and the second started before the first finished sending, a person who got both can have one row attributed to the wrong one (the data cannot tell them apart); it only moves a historic count by a row or two.
- Data: `notification_broadcasts` (one row per send, with counts) and `notification_logs.broadcast_id` (one row per person per send, unique).

### Broadcast pictures (upload)

The Broadcasts page can upload a picture instead of pasting a link: the admin picks any JPEG, PNG or WebP at least 512 pixels wide; the browser crops the centre to 2:1, shrinks it to 1024x512 and compresses it to a JPEG (aiming at 400 KB; Firebase's limit is 1 MB), and `POST /api/v1/admin/notifications/broadcast-image` re-checks it (a real JPEG or PNG judged by its bytes, 512-2048 px wide, about 2:1, under 1 MB) and stores it. It is **off until a pictures bucket is configured**: the upload answers 503 "not set up", and pasting a link keeps working.

**Why a separate bucket.** A phone fetches the picture itself, so it has to be readable by anyone with the link. The documents bucket is private (identity documents) and must stay so. Pictures go in their own bucket, and only the `broadcasts/` prefix is public. Nothing else may be put in it.

Setup (by hand, once per environment; not in Terraform, because the app's S3 settings are not managed there either):
1. Create a bucket, e.g. `ocar-prd-public`, in `ap-south-1`. Turn off "block public access" for **bucket policies** only (`BlockPublicPolicy` and `RestrictPublicBuckets` off; keep the two ACL blocks on). Do not use ACLs.
2. Bucket policy, public read of the prefix only:
   `{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadBroadcastPictures","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::ocar-prd-public/broadcasts/*"}]}`
3. Let the API's role (or keys) write there: `s3:PutObject` on `arn:aws:s3:::ocar-prd-public/broadcasts/*`. It needs no read, list or delete.
4. Optional: a lifecycle rule that expires `broadcasts/` after 120 days (a picture only matters while a push can still be delivered, at most a day).
5. Set two environment values for the API and restart it: `BROADCAST_IMAGE_BUCKET=ocar-prd-public` and, optionally, `BROADCAST_IMAGE_BASE_URL=https://ocar-prd-public.s3.ap-south-1.amazonaws.com` (the public address with no trailing slash; leave empty to use the bucket's own S3 address). **The address must be a public `https` one**: a broadcast whose picture link is not is refused ("Picture: Image must be a public https link"), so an `http` or private base URL would let uploads work and then every send fail.
6. Check: upload a picture on the Broadcasts page, open the link it was given in a private browser window (it must load without signing in), and send a broadcast to your own number.

Each upload gets a new random name and is served with a one-year cache header, so a picture never changes after it is stored. Pictures are never deleted by the app.

## Admin accounts: invites, passwords, audit

Admin -> **Admins** (super admin only). A super admin invites by email and role; the invitee gets a link (valid **48 hours**, usable **once**) and sets a password on `/accept-invite`.

- **Expired invites.** An unanswered invite is shown as **Expired** once its 48 hours pass (the row itself still says `pending` until someone tries the link; every list, the duplicate check and the accept page treat it as expired). The person can simply be invited again, and the row has an "Invite again" button that pre-fills the form. Before this change an expired invite kept blocking new ones until someone revoked it.
- **Already an admin.** Inviting an address that already has an admin account (any letter case, including a removed one: `admins.email` is unique across all of them) is refused up front with "An admin account with this email already exists". Addresses are trimmed and lower-cased.
- **Password rule.** At least **12** characters (64 at most), no character-mix rules, no expiry (NIST SP 800-63B-4). A new password is refused if it contains `ocar` or the first part of the person's email (4+ characters), or if it appears in a known data breach. The breach check uses Have I Been Pwned's range API: only the first 5 characters of the password's SHA-1 leave the server, with padding on, and a timeout or outage **lets the password through** (it can never stop an activation). Switch it off with `PASSWORD_BREACH_CHECK=off` on a network with no outbound access. The check only runs for someone holding a live invite, so the public endpoint cannot be used to test passwords. Existing admins are not affected: the login form keeps its old 8-character floor, so nobody is locked out.
- **Audit log** (Admin -> Audit Log, super admin): `admins.invite_create` (who invited which address as which role), `admins.invite_revoke`, `admins.invite_accept` (the new admin is the actor; records who invited them) and the existing `admins.status_change`. Tokens are never written to the audit log, the database (only a SHA-256 hash) or the server logs.
- **The invitation email** (`api/src/modules/admin-invites/admin-invite-email.ts`): an HTML email with a plain-text version sent together, with a button and the plain link as a fallback. It names who invited the person and as which role, gives the expiry in Indian time ("Wed, 25 Nov 2026, 3:00 pm IST"), says the link works once and for 48 hours, gives the password rule and a "not expecting this? ignore it" notice, and replies go to the inviter. It loads nothing from the internet (no images or fonts). The wording lives in code, not in Notification Templates: the old `admin_invite` row there **no longer affects this email** and can be deactivated in a later release (do not delete it before every server runs this version, because the previous release still reads it).
- **Email setup (do this before relying on invites).** Pick the service with `EMAIL_PROVIDER`: `smtp` for **Google Workspace** (recommended while volume is a handful of emails: no sandbox, no extra cost) or `ses` for Amazon SES (the default; needs a verified domain and a request to leave the SES sandbox, which AWS answers within about 96 hours). `ADMIN_APP_URL` must be the public https address of the admin app: with production settings, an invite is **refused** if it is localhost or not https, because the link would not work. If the sender (`EMAIL_FROM`, or the old `SES_FROM_EMAIL`) is empty in production the invite job **fails** (visible in the API log and `notification_logs` as failed, retried 3 times) instead of being recorded as sent, and the email is never written to the log. A non-production server with no sender can set `ALLOW_DEV_EMAIL=true` to have the email printed to its log, so a tester can read the link. There is no start-up check for the sender yet (it would stop a deploy where it is unset); add one once it is confirmed set on prd and stg.
- **Google Workspace setup (`EMAIL_PROVIDER=smtp`).** Tested with a real send: a Workspace mailbox signing in to **`smtp.gmail.com`** (port 587, STARTTLS) with an **app password** worked (`250 2.0.0 OK`). Limit 2,000 messages per mailbox per day. Steps:
  1. Pick the sender mailbox (an existing one is fine; a new `no-reply@` may use a paid seat). Sign in as it, turn on **Google Account -> Security -> 2-Step Verification**, then **App passwords** -> create one ("Ocar API") and copy the 16-character code (shown once). If App passwords is missing, a Workspace admin may need to allow 2-Step Verification for that user. Google no longer accepts the normal password for SMTP.
  2. Check **DKIM** is on for the domain (Admin console -> Gmail -> Authenticate email) and the domain has SPF and DMARC records, or invites may land in spam.
  3. Set on the API (secrets: never commit, never paste in chat): `EMAIL_PROVIDER=smtp`, `EMAIL_FROM=Ocar Admin <mailbox@your-domain>`, `SMTP_USER=mailbox@your-domain`, `SMTP_PASS=<the app password>`. `SMTP_HOST=smtp.gmail.com` and port 587 are the defaults. `SMTP_SECURITY=none` is refused in production, and a server that will not upgrade to TLS makes the send fail rather than fall back to plain text.
  4. Restart the API (each server reads its settings at boot), invite your own address, and open the email in a real inbox. Sent invites also appear in the mailbox's Sent folder.
  A wrong or revoked app password shows up as a failed invite job in the API log and `notification_logs`. To test a mailbox from a terminal without deploying anything: `node -e "require('nodemailer').createTransport({host:'smtp.gmail.com',port:587,requireTLS:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}).sendMail({from:process.env.SMTP_USER,to:process.env.TO,subject:'test',text:'ok'}).then(r=>console.log('sent',r.response),e=>console.log('FAILED:',e.message))"` from `api/`, with `SMTP_USER`, `SMTP_PASS` and `TO` set in that terminal only.
  **Not recommended: Google's SMTP relay (`smtp-relay.gmail.com`).** It is meant for servers whose public IP addresses are registered in the Admin console. A test from an unregistered address was refused at the first greeting ("421 4.7.0 Try again later, closing connection"), and our servers' addresses change on a blue/green deploy. Use it only if the API gets a fixed outbound address that is registered there.
- **Still open: mandatory 2FA is switched off.** `api/src/middleware/auth.middleware.ts` has `const mustEnrollTotp = false && ...` (commit 3ce664e4, "temp: hard-disable mandatory TOTP enrollment for dev (revert before ship)"), so super and finance admins can work with a password alone. Re-enable it once the Security page's setup flow has been tested with real accounts, otherwise every such admin is locked out until they enrol.

## Driver identity verification (selfie + number plate)

Design: `docs/superpowers/specs/2026-11-02-driver-identity-verification-design.md`. Goal: stop one account being driven by
several people. The daily selfie is matched to the onboarding selfie and the plate photo is read and compared with the
registered plate, using AWS Rekognition. Everything ships **off**: deploying changes nothing for drivers.

**Switches** (`system_config`, Admin > Config):

| Key | Effect |
|---|---|
| `verification_mode` | `off` (today's behaviour), `shadow` (score and record only, drivers see nothing), `flag` (low scores queue for an admin, drivers keep working, an unusable photo is a retake), `block` (a selfie that does not match stops the driver until an admin clears it). |
| `spot_check_enabled` | `'true'` turns on the re-check: after a random 2-3 rides, or a long one-way/round-trip ride, the driver is taken offline and must redo selfie + plate to go online. Only acts while `verification_mode` is not `off`. |
| `spot_check_rides_min` / `_max` | The random "after N rides" range (default 2-3). |
| `spot_check_long_ride_km` / `_minutes` | A completed one-way or round-trip ride at or above either always triggers a re-check (60 km / 90 min). |
| `verification_face_pass_min` / `_review_min` | Similarity at or above pass = pass; between = admin review; below = mismatch. Start 90 / 75; **calibrate in shadow first**. |
| `verification_retake_max` | Retakes of an unusable photo per day before it goes to an admin (3). In block mode also the number of mismatches before "An admin will review this". |

`drivers.verification_mode_override` (`off|shadow|flag|block`) beats the global mode for one driver: use it to pilot on a
single phone, or to exempt the seeded load-test drivers (`+918888%`), without touching everyone.

**Go-live order (do not skip steps):**

1. **IAM first.** The API's AWS identity needs `rekognition:DetectFaces`, `CompareFaces`, `DetectText` and read on the photo
   bucket. Via the prd process only; any change here needs ops approval. Check with `aws rekognition detect-faces` against a
   test object. Rekognition must be in the bucket's region (`S3_REGION`, ap-south-1).
2. **Raise the driver app minimum version** (`app_update_driver_android_min`) to a build that has the consent card, the
   "Quick safety check" screen and the retake messages, **before** `flag`, `block` or `spot_check_enabled`. An older build cannot
   show the consent card or read the retake reasons and would see a generic error.
3. **Shadow for at least 7 days.** Scores are stored but nothing is enforced. Read the similarity histogram in Admin >
   Verifications > stats (`GET /api/v1/admin/verifications/stats`), then set the two thresholds so the review band yields about
   20-30 cases a day (the admin budget).
4. **Legal sign-off** on the consent wording and photo retention (the consent card says photos are kept "only as long as
   these checks need them"; there is **no automatic deletion job yet**, so decide retention before `flag`).
5. **Flag for about 2 weeks**, then enable `spot_check_enabled`. Admins work the queue in Admin > Verifications (J/K move,
   O looks fine, M mismatch).
6. **Block** only when the confirmed-ok vs confirmed-mismatch rates look right.

**Roll back:** set `verification_mode` to `off`. A driver with an open re-check is released at once (an open challenge is
ignored while verification is off). Nothing else needs undoing.

**A driver says "I'm offline and can't verify"** (broken camera, no light): Admin > Verifications > **Open checks** > Waive
check. They can then go online; the waiver is in the audit log.

**If Rekognition is down:** the daily check still completes (scoring fails open) and the case is queued for review at the
lowest priority; no driver is stopped by an outage.

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

## Stand up / tear down staging

Staging is `stg`. Bring-up, changes (instance, database) and teardown are in `docs/STG_ENVIRONMENT.md`:
`pnpm infra:stg:init|check|plan|apply`, and `pnpm infra:stg:destroy` to remove it. A push to `develop` deploys to it.

## Who can do what (current gaps — see CLAUDE.md "Pending Ops Actions")

- Deploys to `main` currently run with **no human approval gate** — the
  `production` GitHub Environment referenced in `deploy.yml` doesn't exist
  yet, so it's inert. Needs repo admin to create it.
- No branch protection on `main` — a direct push bypasses PR review
  entirely (CI still has to pass before *deploy*, but not before *merge*).

Whoever has GitHub org/repo admin rights should close these before treating
this pipeline as fully production-hardened — exact `gh api` commands are in
`CLAUDE.md`.
