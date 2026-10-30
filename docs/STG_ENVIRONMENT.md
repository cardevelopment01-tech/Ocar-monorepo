# stg: the staging environment (how to bring it up, change it and take it down)

`stg` is the final staging environment. It replaces the old prod stack (`ocar-prod-*`, scaled to 0 on 2026-10-30, to be
destroyed) and the old empty `staging`. Production is `prd` (see `docs/INFRA_ENVIRONMENTS.md`).

**Status (update when it changes):** defined and planned (`80 to add, 0 to change, 0 to destroy`), **not applied yet**.

It is deliberately smaller than prd, so capacity numbers measured on prd (about 190 users, 6,000 requests a minute per
t3.medium server) do **not** carry over. Nothing in stg is protected: the DB has no deletion protection and no final
snapshot, so destroying it loses its data.

## What it is

| | stg |
|---|---|
| Terraform `environment` | `stg` |
| Branch | `infra/stg-environment` (cut from `infra/prd-environment`) |
| Files | `infra/terraform/stg.tfvars` (gitignored, commit with `git add -f`), `infra/terraform/stg.backend.hcl` |
| State | `s3://ocar-terraform-state/stg/terraform.tfstate`, local data dir `.terraform-stg` |
| Names | `ocar-stg-*` (clean names, no legacy ones); SSM `/ocar/stg/*`; DB `ocar-stg-db` |
| Region / account | `ap-south-1` / `822127610728` |
| Hostname | `stg.api.ocarindia.com` (a decision; see "Hostname") |
| Network | VPC `10.2.0.0/16`, subnets `10.2.0.0/24` and `10.2.1.0/24` (prod is 10.0, prd is 10.1) |
| Servers | `t3.small`, blue/green ASGs, active colour `blue`, 1 to 4 servers, CPU target 19% |
| Database | `db.t4g.small`, PostgreSQL 18.4, Single-AZ, 100 GB (grows to 300), empty at first |
| Cache | one `cache.t4g.micro` Valkey node |
| Monitoring | standard 5-minute EC2 metrics (`detailed_monitoring` is off) |

## Commands

Run everything from the repo root. They go through `infra/scripts/tf-guard.mjs`, which sets the right data dir and
refuses to run if the backend does not match stg.

| Task | Command |
|---|---|
| Set up locally (once) | `pnpm infra:stg:init` |
| Check you are pointed at stg | `pnpm infra:stg:check` |
| Preview changes (changes nothing in AWS) | `pnpm infra:stg:plan` (saves `stg.tfplan`) |
| Apply the previewed plan | `pnpm infra:stg:apply` (re-checks the plan, then asks you to type `apply stg`) |
| **Destroy all of stg** | `pnpm infra:stg:destroy` (prints everything it will remove, then asks you to type `destroy stg`) |

The guard refuses `destroy` for prod and prd, and refuses `apply` for prod.

Never run `terraform plan/apply -var-file=stg.tfvars` by hand unless `TF_DATA_DIR=.terraform-stg` is set. With another
environment's state loaded it would plan to replace that environment's resources.

## Bring it up

Do these in order. Only the first three are manual.

1. **Create the SSM parameters Terraform does not create** (the servers read them when they boot, so they must exist
   before the first `apply` finishes). Copy the shape from `/ocar/prd/*`, but with stg's own values. Never reuse
   another environment's database or Redis URL in `api-env` (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_SECRET_ARN` are not in
   `api-env`; the servers read them from RDS).

   | Parameter | Type | Value |
   |---|---|---|
   | `/ocar/stg/api-env` | SecureString | the API's environment file (stg URLs, **test** provider keys, never prod's) |
   | `/ocar/stg/active-color` | String | `blue` |
   | `/ocar/stg/blue/image-tag` | String | an image tag from GHCR, e.g. `sha-xxxxxxx` |
   | `/ocar/stg/green/image-tag` | String | the same tag |
   | `/ocar/stg/ghcr-token` | SecureString | a GHCR pull token |

2. **Make sure stg cannot reach real people.** In `api-env`, use test/sandbox keys for SMS, push, payments and calls.
   A staging server with prod's keys sends real messages to real drivers.
3. `pnpm infra:stg:init`, then `pnpm infra:stg:check`.
4. `pnpm infra:stg:plan`, **read it** (a first apply is about 80 additions and nothing else), then `pnpm infra:stg:apply`.
5. **While the apply waits, add the certificate CNAME in Cloudflare** (DNS only, not proxied). The apply stops at the
   certificate validation until it exists. Get the record from the ACM console or with:
   `aws acm describe-certificate --region ap-south-1 --certificate-arn <arn> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'`
   (find the ARN with `aws acm list-certificates --region ap-south-1`).
6. After the apply, create the Cloudflare record `stg.api.ocarindia.com` pointing at the load balancer
   (`alb_dns_name` output).
7. Deploy the API. **Not wired yet:** `.github/workflows/deploy.yml` knows `prod`, `prd` and `staging` only. Adding `stg`
   needs a `stg` GitHub Environment, repo variables `STG_ALB_DNS_NAME` and `STG_GHA_DEPLOY_ROLE_ARN` (outputs
   `alb_dns_name` and `github_actions_deploy_role_arn`), and the `stg` branches in the workflow's `changes`, `environment`,
   `ALB_DNS_NAME`, `SMOKE_TEST_HOST` and `role-to-assume` expressions. Until then, set the image tag in SSM and replace
   the server by hand.
8. The first deploy runs the migrations on the empty database. The database starts empty; set `db_snapshot_identifier`
   in `stg.tfvars` before the first apply only if stg should start with data (it is read only on first creation).

## Change something

Edit `infra/terraform/stg.tfvars`, then `pnpm infra:stg:plan`, read it, `pnpm infra:stg:apply`. Never change AWS by hand
without putting the same value in the file, or the next apply will undo it.

| To change | Edit | What happens, and what to watch |
|---|---|---|
| Server size | `instance_type` (now `t3.small`) | A new launch-template version. **Running servers keep the old size** until replaced: deploy, or terminate the server and the ASG launches one with the new size (a short outage; fine for staging). |
| Database size | `db_instance_class` (now `db.t4g.small`) | In-place change, a few minutes of downtime. `rds.tf` does not set `apply_immediately`, so it waits for the maintenance window; to apply now, run `aws rds modify-db-instance --db-instance-identifier ocar-stg-db --db-instance-class <class> --apply-immediately` and keep the file in step. |
| Database storage | `db_allocated_storage`, `db_max_allocated_storage` | Storage can only grow, never shrink. Shrinking means rebuilding the DB from a snapshot. |
| Standby database | `db_multi_az = true` | Adds a failover standby (doubles the DB cost). |
| Cache size | `valkey_node_type` | Changes the cache node (a brief interruption; cached data and queued jobs may be lost). |
| When servers scale out | `asg_cpu_target_percent` (default 19) | Lower means earlier scale-out. |
| Most servers it may start | `max_size = 4` in `asg.tf` | Hard-coded; applies to every environment. |
| 1-minute CPU metrics | `detailed_monitoring = true` | About $2.10 per server per month; makes the scaling rule react in minutes. |
| Hostname | `domain_name` | Replaces the certificate; needs a new Cloudflare validation CNAME. |
| Network ranges | `vpc_cidr`, `public_subnet_cidrs` | Replaces the whole network. Do not change after the first apply. |
| Image the servers run | the SSM `/ocar/stg/<colour>/image-tag` parameters | Normally done by the deploy workflow, not by Terraform. |

Connection limit: a `db.t4g.small` has 2 GiB, so its `max_connections` is far below prd's 399. An API server can hold up to
`DATABASE_POOL_MAX` + `WORKER_POOL_MAX` + `ANALYTICS_POOL_MAX` connections (set in `api-env`; prod ran 50 for the main pool), so
keep those small, or run one server, on stg.

## Pause and resume (manual only, saves about half the cost)

Nothing pauses stg on a timer, so a night-time test is never interrupted. Pause it yourself when you are done.

| Command | What it does |
|---|---|
| `pnpm infra:stg:status` | servers, database, active colour, and whether stg is RUNNING or PAUSED |
| `pnpm infra:stg:pause` | both ASGs to 0 servers, then stops the database |
| `pnpm infra:stg:resume` | starts the database, waits for it, puts 1 server on the active colour, waits for a healthy target (about 5 to 10 minutes) |

Add `--dry-run` (`node infra/scripts/stg-power.mjs pause --dry-run`) to see the steps without doing them. The script only touches
`ocar-stg-*` resources, never lowers a running stg, and Terraform ignores the ASG sizes, so they do not fight.

**What a pause saves, and what keeps billing.** Saved: the server and the database compute. Still billed: database storage, the cache
node, the load balancer and its public IPs (they cannot be paused), about half of the running cost. AWS restarts a stopped database
by itself after 7 days, so a pause longer than a week needs another `pause`; for weeks of idleness use `pnpm infra:stg:destroy`
(and `pnpm infra:stg:apply` to build it again).

- **From GitHub instead of a terminal:** Actions, **Stg Power (pause / resume)**, Run workflow, pick `status`, `pause` or `resume`.
  It needs the repo variable `STG_GHA_POWER_ROLE_ARN` (Terraform output `github_actions_power_role_arn`); the role can only resize
  the two stg ASGs, stop/start `ocar-stg-db`, and read the active colour and target health.
- **A deploy while stg is paused fails** at the migration step (no server to run it on). Resume first, then re-run the deploy.
- **Alerts:** a paused stg trips "Alloy heartbeat lost" and the admin-digest alert (`env="stg"`). Expect them, or silence them in
  Grafana for the time you are paused.

## Take it down

`pnpm infra:stg:destroy` removes everything stg owns, and nothing else (it only knows stg's state). Before running it:

1. **Save anything you want to keep.** The DB has no final snapshot. For a keepsake:
   `aws rds create-db-snapshot --db-instance-identifier ocar-stg-db --db-snapshot-identifier ocar-stg-db-keep-<date>`.
2. **Empty the metrics-archive bucket.** `ocar-stg-metrics-archive` is not force-destroyable, so a non-empty bucket makes
   the destroy fail: `aws s3 rm s3://ocar-stg-metrics-archive --recursive` (also remove old versions if it is versioned).
   `ocar-stg-logs-archive` empties itself on destroy.
3. Run it, read the list, and type `destroy stg`.

Destroy does **not** remove, so clean these up by hand: the SSM parameters you created (`/ocar/stg/api-env`,
`active-color`, `blue/image-tag`, `green/image-tag`, `ghcr-token`), the Cloudflare CNAME records (certificate validation
and `stg.api.ocarindia.com`), the `stg` GitHub Environment and its variables, and any manual snapshots.

## Safety rules

- stg is not protected (`local.protected` in `iam.tf` is false for it). Never loosen that for prod or prd, and use
  `local.protected`, not a bare `environment == "..."` test, for anything that guards deletion.
- Names that AWS cannot change in place use the clean form for stg (`local.legacy_names` is false for it). Do not widen
  `legacy_names` to prod or staging.
- stg shares the AWS account, the Grafana credentials (`/ocar/observability/*`) and the state bucket with the other
  environments. Everything else is its own.
- Staging-style extras (the metrics-archive bucket and the restore/archive SSM scripts) are controlled by
  `local.is_staging` in `iam.tf`, which is true for `staging` and `stg`.
