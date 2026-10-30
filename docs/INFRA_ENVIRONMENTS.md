# Infrastructure environments and how to operate them

One Terraform code base (`infra/terraform`) builds every environment. An environment is just the value of
`var.environment`; each one has its own state, names, database and secrets.

**Status (update when it changes):** `prd` is planned but not yet applied. See `docs/PRD_CUTOVER_CHECKLIST.md`
for the build-and-cutover order. After cutover, `prd` is production and `prod` becomes staging.

## Environments

| Terraform `environment` | Role | State key | Data dir | Names | SSM path | Database |
|---|---|---|---|---|---|---|
| `prod` | live production now; becomes staging after cutover (keep the value `prod`, renaming would replace the DB) | `prod/terraform.tfstate` | `.terraform` | `ocar-prod-*` | `/ocar/prod/*` | `ocar-prod-db` |
| `prd` | new production | `prd/terraform.tfstate` | `.terraform-prd` | `ocar-prd-*` | `/ocar/prd/*` | `ocar-prd-db` (Multi-AZ) |
| `staging` | old staging, to be deleted after cutover | `staging/terraform.tfstate` | `.terraform` | `ocar-staging-*` | `/ocar/staging/*` | its own |

All live in AWS account `822127610728`, region `ap-south-1`, state bucket `ocar-terraform-state`.
`prod` and `prd` are both protected (DB deletion protection and final snapshot); `staging` is not.

## Commands

Run everything from the repo root. The prd commands go through `infra/scripts/tf-guard.mjs`, which sets the right data
dir for you and refuses to run if the backend does not match the environment.

| Task | Command |
|---|---|
| Set up prd locally (once) | `pnpm infra:prd:init` |
| Check you are pointed at the right state | `pnpm infra:prd:check` / `pnpm infra:prod:check` |
| Preview prd changes | `pnpm infra:prd:plan` (saves `prd.tfplan`) |
| Apply prd changes | `pnpm infra:prd:apply` (re-checks the plan file, then asks you to type `apply prd`) |
| Preview prod changes | `pnpm infra:prod:init` once, then `pnpm infra:prod:check`, then `pnpm infra:prod:plan` (saves `prod.tfplan`; changes nothing in AWS) |
| Apply to prod | **Refused by the guard.** Needs an explicit decision and approval; run `terraform apply prod.tfplan` by hand after `pnpm infra:prod:check` |

What the guard checks: the data dir's state key is exactly this environment's, the backend file and `prd.tfvars` agree
with it, AWS credentials work, and, before an apply, that the plan was made for `prd`, deletes nothing, and touches
nothing named `ocar-prod-*`.

Never run a plan or apply by hand with `-var-file=prd.tfvars` unless `TF_DATA_DIR=.terraform-prd` is set. With prod's
state loaded, that would plan to replace prod's resources.

## Deploying the API

- **prd (production):** automatic. A push to `main` runs CI, then `.github/workflows/deploy.yml` (blue/green, see
  `docs/BLUE_GREEN_ARCHITECTURE.md` and the "Deploy new API code" section of `docs/OPS_RUNBOOK.md`). The deploy job
  waits for the `prd` GitHub Environment's required reviewer. A manual run (Actions, **Deploy**, Run workflow,
  environment `prd`) redeploys a commit and works from `main` only (the workflow fails on any other branch). It needs the
  repo variables `PRD_ALB_DNS_NAME` and `PRD_GHA_DEPLOY_ROLE_ARN` (Terraform outputs `alb_dns_name` and
  `github_actions_deploy_role_arn` of the prd apply).
- **old prod stack (`ocar-prod-*`):** no longer deployed to, by push or by dispatch. It is to be destroyed and rebuilt as
  staging; `develop` then deploys to it through the existing `staging` branch of the `changes` job.

## Configuration and secrets

| What | Where |
|---|---|
| Per-environment Terraform inputs | `infra/terraform/prd.tfvars`, `staging.tfvars`. **Gitignored**, so commit with `git add -f`. prod uses the defaults in `variables.tf`, so a changed default changes prod |
| API settings and secrets | SSM SecureString `/ocar/<env>/api-env` (whole-value edit; see "Rotate a secret" in the runbook) |
| Image tags, active colour | `/ocar/<env>/blue/image-tag`, `/ocar/<env>/green/image-tag`, `/ocar/<env>/active-color` |
| GHCR pull token | `/ocar/<env>/ghcr-token` |
| Grafana credentials (shared) | `/ocar/observability/*` |

`DB_HOST`, `DB_NAME`, `DB_USER` and `DB_SECRET_ARN` are not in `api-env`: instances read them from RDS at boot. Do not
put another environment's database or Redis URL into an `api-env`.

## Common tasks

- **Change infrastructure in prd:** edit `infra/terraform/*.tf` (or `prd.tfvars`), `pnpm infra:prd:plan`, read the plan,
  `pnpm infra:prd:apply`. Do the same change for prod only if it is meant to reach the live stack.
- **Change capacity:** the CPU target is `asg_cpu_target_percent` (default 19); instance type is `instance_type`;
  Multi-AZ is `db_multi_az`; the DB size variables are `db_instance_class`, `db_allocated_storage`,
  `db_max_allocated_storage`. See "Scale capacity" in the runbook.
- **Restore a database:** always into a new instance. Set `db_snapshot_identifier` for a new environment; it is only
  read on first creation and never rebuilds a live DB.
- **Naming rule:** names that AWS cannot change in place (ASG, target group, launch template prefix, scaling policy,
  security groups) keep their old form for `prod` and `staging` and use `ocar-<env>-<thing>-<color>` for `prd`
  (`local.legacy_names` in `iam.tf`). Do not widen that to prod or staging; it would replace live resources.
- **Protection rule:** use `local.protected` (`iam.tf`), never a bare `environment == "..."` test, for anything that
  guards deletion.

## Where to read more

- Build and cutover order: `docs/PRD_CUTOVER_CHECKLIST.md`
- Deploy mechanics and failures: `docs/BLUE_GREEN_ARCHITECTURE.md`, `docs/OPS_RUNBOOK.md`
- Staging spin-up and teardown: "Stand up / tear down staging" in `docs/OPS_RUNBOOK.md`
