# Blue/Green Deployment for the API Fleet

Client-requested replacement for the current rolling deploy, specifically to
close the gap they called out: during a rolling `instance_refresh`, old-code
and new-code instances serve traffic *simultaneously* for the minutes it
takes to cycle through the ASG. For a stateless REST call that's usually
harmless. For this app it isn't purely theoretical: drivers hold long-lived
Socket.io connections (GPS ping every 3-5s, see `CLAUDE.md`'s Socket.io
section) that stay pinned to whichever instance they connected to. A driver
connected to an old-code instance mid-rollout stays on old code — including
any socket-event contract change — until that instance is replaced and the
client reconnects. That's the real failure mode blue/green is meant to close,
not "downtime" (the current rolling deploy is already zero-downtime by
design — see `asg.tf`'s `instance_refresh` comment).

This doc is the design + implementation plan. Nothing here is applied yet —
build and prove it on **staging first** (which is being stood up anyway per
the client's own task list), then port the same Terraform/workflow changes to
prod once it's validated end-to-end there.

---

## 1. What "done" means

- A new image can go live with **zero instances ever running old and new
  code for the same listener** — every request/socket connection is served
  by exactly one version at any instant, and the cutover from one version to
  the other is a single atomic action, not a gradual replacement.
- The switch is **not DNS-based**. DNS records get cached by clients and
  resolvers (TTL), so a DNS-level cutover isn't instant and can leave
  stragglers on the old environment for minutes to hours — reintroducing the
  exact mixed-version window blue/green exists to remove. The switch happens
  at the **ALB listener** instead: a single `ModifyListener` API call flips
  which target group is "default," and every *new* HTTP request and
  WebSocket handshake after that call goes to the new color. This is the
  standard AWS pattern for blue/green behind an ALB.
- The idle color is validated **before** it ever receives real traffic
  (health checks + smoke test against it directly, through the same public
  ALB, via a preview header — no live user hits it while it's unproven).
- Rollback after cutover is **instant** — flip the listener back — because
  the old color is deliberately kept running (not scaled down) for a bake
  period after cutover, not torn down immediately.
- Existing driver/rider sockets connected to the old color at cutover time
  are not abruptly cut — they finish draining naturally over the bake
  window, then reconnect (Socket.io's client auto-reconnects on disconnect)
  and land on the new color via the ALB, which is now the only one accepting
  new connections.

## 2. What this does NOT fix by itself

Blue/green solves *routing* — it does not make an old-code instance and a
new-code instance compatible with each other's expectations of the database.
Both colors share **one RDS instance** (see `rds.tf`) and **one Valkey node**
(see `elasticache.tf`) — that's deliberate (a shared DB is the only way both
colors see the same booking/ride state), but it means:

- **Every migration must be additive/backward-compatible within a single
  release** (expand → deploy → contract in a *later* release, standard
  practice: add nullable columns/new tables in this deploy, only drop/rename
  old columns in a subsequent deploy once you're certain nothing still reads
  them). If a migration renames a column and the same deploy's old-color
  instances are still running during the bake window, those instances break
  against the new schema — blue/green's routing isolation doesn't protect
  against that, only clean migration discipline does.
- This is not a new requirement blue/green introduces — it's already
  implicitly true today under the rolling deploy (old and new instances
  already briefly coexist), blue/green just makes the *coexistence window*
  explicit and boundable (the bake period) instead of an implicit few
  minutes during instance replacement.

One thing that already works in our favor: Socket.io's cross-instance
broadcast (`@socket.io/redis-adapter`, `socket.server.ts`) is backed by the
**shared** Valkey node, not in-process memory. A ride-assignment broadcast
fired from a green instance still reaches a driver's socket held open on a
blue instance. Blue/green doesn't have to solve pub/sub fanout across colors
— it's already environment-agnostic.

## 3. Architecture

Today (`asg.tf`/`alb.tf`): one ALB, one target group, one ASG, one launch
template, per environment. The listener's `default_action` forwards to that
one target group.

Proposed: **two full parallel compute stacks per environment** ("blue" and
"green"), sharing everything that must stay singular (VPC, ALB, RDS, Valkey,
ACM cert, IAM role shape):

```
                          ┌─────────────────────────────┐
 Internet ──443──▶  ALB   │ listener default_action:     │
                    │      │   -> active color's TG       │
                    │      │ listener rule (header match): │
                    │      │   X-Deploy-Preview: <color>  │
                    │      │   -> that color's TG directly │
                    └──┬───┴─────────────┬────────────────┘
                       │                 │
              ┌────────▼──────┐  ┌───────▼────────┐
              │ TG: blue       │  │ TG: green       │
              │ ASG: blue      │  │ ASG: green      │
              │ (min 2, or 0   │  │ (min 2, or 0    │
              │  when idle)    │  │  when idle)     │
              └────────┬───────┘  └────────┬────────┘
                       │                    │
                       └─────────┬──────────┘
                                 │
                    shared: RDS Postgres, Valkey, VPC, ACM cert
```

Both ASGs exist in Terraform **all the time** — this is what makes the
"idle" color instantly available for the next deploy instead of something
built from scratch each time. Whichever color isn't currently live is scaled
to `desired_capacity = 0` most of the time (no idle compute cost between
deploys), and only scaled up to 2 right before a deploy starts.

### 3.1 Terraform changes (`infra/terraform/*.tf`)

Use `for_each = toset(["blue", "green"])` to avoid duplicating every
resource block — matches the existing "shortest diff" style already used
throughout this config (e.g. `dynamic "ingress"` in `security-groups.tf`).

| Resource | Change |
|---|---|
| `aws_launch_template.api` | `for_each` over color. `user_data` template gets a new `color` var, used to read a **per-color** image-tag SSM parameter (see below) — this is the detail that makes "update the new color's image without touching the live one" work. |
| `aws_autoscaling_group.api` | `for_each` over color. `desired_capacity`/`min_size` become **variables the deploy workflow controls at runtime** (`aws autoscaling update-auto-scaling-group`), not fixed Terraform values — Terraform sets them once at creation (`min=0` for both, so `terraform apply` never fights the deploy workflow's scaling), the workflow owns day-to-day scaling the same way it already owns which image tag is live. |
| `aws_lb_target_group.api` | `for_each` over color. Same `/health` check as today. |
| `aws_lb_listener.https` `default_action` | Points at whichever color's target group is currently active. Add `lifecycle { ignore_changes = [default_action] }` — the listener flip happens via an `aws elbv2 modify-listener` CLI call from the deploy workflow, **not** `terraform apply`, so Terraform must not fight it on the next plan. This mirrors how `image-tag`/`api-env` SSM parameters already work today: Terraform owns the *shape*, the deploy pipeline owns *what's currently live*. |
| `aws_lb_listener_rule` (new) | Header-based preview rule: `X-Deploy-Preview: blue` / `green` → routes straight to that color's target group, bypassing whichever is "default." Same pattern already established by the existing `maintenance` listener rule in `alb.tf` — nothing new conceptually, just a second rule. This is how the deploy workflow smoke-tests the idle color through the real public ALB (real TLS, real DNS) before it's ever live. |
| `aws_ssm_parameter` (new, x2) | `/ocar/{environment}/blue/image-tag` and `/.../green/image-tag` replace the single shared `image-tag` parameter — each color's launch template reads only its own, so updating green's tag can never affect a currently-running blue instance. |
| `aws_ssm_parameter.active_color` (new) | `/ocar/{environment}/active-color` — single source of truth for "which color is currently live," read by the deploy workflow at the start of every deploy to compute the idle color. Same pattern as the existing `image-tag` parameter. |
| `iam.tf`'s `read_boot_parameters` policy | Extend `Resource` list to cover both per-color image-tag parameter ARNs (currently scoped to the single shared one). |
| ASG `tag` blocks | Add a `Color` tag (`blue`/`green`) — lets Grafana/Alloy dashboards split metrics by color during a deploy, and lets you `aws ec2 describe-instances --filters Name=tag:Color,...` when debugging which color an instance belongs to. |

Net new Terraform: roughly 150-250 lines (mostly `for_each`-driven
duplication of existing blocks, not new concepts) plus the one new listener
rule and two new SSM parameters.

### 3.2 Deploy workflow changes (`.github/workflows/ci-cd.yml`'s `deploy` job)

Current flow (per `CLAUDE.md`): pull new image → run migrations → cut over
container → `/health` check → smoke-test → auto-rollback to previous image
tag on failure. New flow, same shape, different mechanics:

1. **Read active color** from `/ocar/{env}/active-color` SSM param. `idle = active == 'blue' ? 'green' : 'blue'`.
2. **Write the new image tag** to the *idle* color's own SSM parameter only (`/ocar/{env}/{idle}/image-tag`) — the active color's parameter is untouched, so its running instances have no reason to change.
3. **Run migrations** against the shared RDS instance (same ad-hoc migration container pattern already in place) — must be additive/backward-compatible per §2.
4. **Scale the idle color's ASG up** to `desired_capacity = 2` (`aws autoscaling update-auto-scaling-group`). New instances boot, pull the new image tag from their own SSM parameter, register with their target group.
5. **Wait for idle color's targets to pass ELB health checks** (`aws elbv2 describe-target-health`, poll until healthy — same `/health` endpoint already used).
6. **Smoke test the idle color directly**, through the public ALB, using the header-preview listener rule (`curl -H "X-Deploy-Preview: <idle>" https://api.ocar.../api/v1/geo/cities`) — same smoke check already in the current pipeline, just aimed at the idle color specifically instead of "whatever's live."
7. **If the smoke test fails:** scale the idle color back to 0, leave the active color untouched, fail the deploy loudly. Nothing user-facing ever changed.
8. **If it passes: flip the listener.** `aws elbv2 modify-listener --default-actions ...` pointing `default_action` at the idle color's target group. This is the one atomic moment traffic actually moves — a single API call, no propagation delay.
9. **Update `active-color`** SSM parameter to the (now-live) idle color.
10. **Bake period** (e.g. 10 minutes, tunable): monitor the ALB's `HTTPCode_Target_5XX_Count` and `TargetResponseTime` CloudWatch metrics on the *new* active color. The old color is still fully running — not receiving new connections (no longer the listener default), but existing driver/rider sockets on it keep working until they naturally disconnect.
    - **If the bake period shows elevated errors:** instant rollback — flip the listener back to the previous color (still warm, still running, zero rebuild needed). This is the actual improvement over today's rolling deploy, where "rollback" means redeploying the old image and waiting for instances to boot again.
11. **If bake is clean:** scale the old (now-inactive) color's ASG down to 0. Compute cost for the deploy+bake window was roughly double (both colors at `desired_capacity=2` briefly) — bounded to the deploy window, not continuous, so steady-state cost is unchanged from today.

### 3.3 What happens to in-flight sockets during the bake window

This is the specific thing the client called out, so worth being explicit:
the moment the listener flips (step 8), the old color stops receiving *new*
connections but keeps serving connections it already holds — a driver's
socket doesn't get severed mid-flip. Over the bake window, as those sockets
naturally disconnect (app backgrounded, network blip, driver's own periodic
reconnect) they reconnect through the ALB, which now only points at the new
color — so they migrate over organically. When the old color is finally
scaled to 0 (step 11), any socket still open on it is closed at that point,
and the client's Socket.io library auto-reconnects (no reconnection/backoff
logic needed on our side — this is standard Socket.io client behavior),
landing on the new color. At no point does a client get silently switched
between two *different* code versions mid-session without a clean
disconnect/reconnect boundary — which is exactly the "code mismatch" failure
mode the client flagged.

## 4. Rollout plan

1. Build this on **staging** first (`infra/terraform/staging.tfvars`) —
   already the client's own stated plan (staging before prod), and gives a
   safe place to actually trigger a few real deploys through the new
   pipeline before it's anywhere near production.
2. Run at least 3-5 real deploys through it on staging, including one
   deliberately-broken deploy (bad image or a failing migration) to prove
   the rollback path actually works, not just the happy path.
3. Confirm Grafana/Alloy dashboards correctly show both colors during a
   staging deploy (the `Color` tag added in §3.1 should make this visible).
4. Port the same Terraform + workflow changes to prod once staging's proven
   out, following the same `prod.backend.hcl` apply process already
   documented in `CLAUDE.md`.

## 5. Cost impact

Steady state: unchanged — one color live at `desired_capacity=2`
(`t3.medium`), the other at `0`. During a deploy: briefly ~2x compute (both
colors at 2 instances) for the duration of health-check + smoke-test + bake
(roughly 15-25 minutes total, tunable), not continuous. This is a slightly
larger transient spike than today's rolling deploy (which briefly runs
`desired_capacity + 1 = 3` instances during a single-instance replacement),
but bounded to the same deploy window either way.

## 6. Effort estimate

- Terraform: ~1 day (mostly `for_each`-converting existing resources, plus
  the new listener rule and SSM parameters).
- Deploy workflow rewrite: ~1-2 days (color detection, per-color SSM writes,
  scale up/down calls, header-based smoke test, listener flip, bake
  monitoring, rollback path) plus testing time on staging.
- Staging validation (§4): a few deploy cycles, budget a few days of
  calendar time rather than continuous effort (mostly waiting/observing).
