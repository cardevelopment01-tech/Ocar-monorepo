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
  that also needs the same two-layer filtering treatment (`postgres_exporter`
  and the API's own `http_request_duration_seconds` are both real
  contributors that were deliberately left unfiltered this round).

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
