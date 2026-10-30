# Infrastructure environments and how to operate them

One Terraform code base (`infra/terraform`) builds every environment. An environment is just the value of
`var.environment`; each one has its own state, names, database and secrets.

**Status (update when it changes):** two environments exist. `prd` is production (cutover 2026-10-29/30). `stg` is
staging (built 2026-10-30; bring-up, changes and teardown are in `docs/STG_ENVIRONMENT.md`). The old `prod` stack was
destroyed on 2026-10-30 and the old `staging` is gone; neither name is accepted by Terraform any more
(`variables.tf` allows only `prd` and `stg`), so a stray apply cannot rebuild them.

## Environments

| Terraform `environment` | Role | State key | Data dir | Names | SSM path | Database |
|---|---|---|---|---|---|---|
| `prd` | new production | `prd/terraform.tfstate` | `.terraform-prd` | `ocar-prd-*` | `/ocar/prd/*` | `ocar-prd-db` (Multi-AZ) |
| `stg` | the final staging environment (smaller than prd: `t3.small`, `db.t4g.small`); see `docs/STG_ENVIRONMENT.md` | `stg/terraform.tfstate` | `.terraform-stg` | `ocar-stg-*` | `/ocar/stg/*` | `ocar-stg-db` |

All live in AWS account `822127610728`, region `ap-south-1`, state bucket `ocar-terraform-state`.
`prd` is protected (DB deletion protection and a final snapshot); `stg` is not and can be destroyed with one command.

## Commands

Run everything from the repo root. The prd commands go through `infra/scripts/tf-guard.mjs`, which sets the right data
dir for you and refuses to run if the backend does not match the environment.

| Task | Command |
|---|---|
| Set up prd locally (once) | `pnpm infra:prd:init` |
| Check you are pointed at the right state | `pnpm infra:prd:check` / `pnpm infra:stg:check` |
| Preview prd changes | `pnpm infra:prd:plan` (saves `prd.tfplan`) |
| Apply prd changes | `pnpm infra:prd:apply` (re-checks the plan file, then asks you to type `apply prd`) |
| stg: set up, check, preview, apply | `pnpm infra:stg:init`, `infra:stg:check`, `infra:stg:plan`, `infra:stg:apply` (asks you to type `apply stg`) |
| stg: **destroy everything** | `pnpm infra:stg:destroy` (lists what it will remove, then asks you to type `destroy stg`). Refused for prd |

What the guard checks: the data dir's state key is exactly this environment's, the backend file and `prd.tfvars` agree
with it, AWS credentials work, and, before an apply, that the plan was made for that environment and deletes nothing
unless every deleted address is allow-listed (never a database, load balancer, cache, bucket, key or the VPC).

Never run a plan or apply by hand with `-var-file=prd.tfvars` (or `stg.tfvars`) unless the matching `TF_DATA_DIR`
(`.terraform-prd` / `.terraform-stg`) is set. With the other environment's state loaded, that would plan to replace its resources.

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
| Per-environment Terraform inputs | `infra/terraform/prd.tfvars`, `stg.tfvars`. **Gitignored**, so commit with `git add -f`. prod uses the defaults in `variables.tf`, so a changed default changes prod |
| API settings and secrets | SSM SecureString `/ocar/<env>/api-env` (edit with `pnpm env:edit <env>`, see "Editing API settings" below) |
| Image tags, active colour | `/ocar/<env>/blue/image-tag`, `/ocar/<env>/green/image-tag`, `/ocar/<env>/active-color` |
| GHCR pull token | `/ocar/<env>/ghcr-token` |
| Grafana credentials (shared) | `/ocar/observability/*` |

`DB_HOST`, `DB_NAME`, `DB_USER` and `DB_SECRET_ARN` are not in `api-env`: instances read them from RDS at boot. Do not
put another environment's database or Redis URL into an `api-env`.

## Editing API settings (`api-env`)

`/ocar/<env>/api-env` is one SSM SecureString holding the whole environment file. Use the wrapper, not hand-written `aws ssm` commands:

| Task | Command |
|---|---|
| Change one or more keys | `pnpm env:edit prd` (or `stg`): opens `$VISUAL`/`$EDITOR` on the decrypted value, shows what changed, asks you to type `push <env>`, then writes it |
| See who changed what, and when | `pnpm env:history prd` (every stored version: time, IAM user, keys added/changed/removed) |
| Compare a file with live | `pnpm env:diff prd <file>` |
| Push a prepared file | `pnpm env:push stg <file>` |
| Save a local copy | `pnpm env:pull prd [file]` (default `.api-env.<env>`, gitignored; it holds decrypted secrets, delete it after) |

Values are masked in every output (`ab... (24 chars)`); add `--show-values` to see them and `--dry-run` to preview a push. A
write is refused if the file does not parse, if someone changed the parameter after you read it, or if it would drop more
than half of the live keys (`--force` overrides the last one). It keeps the parameter's tier and KMS key. New servers read
the value at boot, so running ones need a redeploy to pick up a change. Tests: `node --test infra/scripts/api-env.test.mjs`.

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
- Staging (stg): bring up, change, destroy: `docs/STG_ENVIRONMENT.md`
- Deploy mechanics and failures: `docs/BLUE_GREEN_ARCHITECTURE.md`, `docs/OPS_RUNBOOK.md`
- Staging spin-up and teardown: "Stand up / tear down staging" in `docs/OPS_RUNBOOK.md`
