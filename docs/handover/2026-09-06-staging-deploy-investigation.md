# Staging Deploy Investigation — 2026-09-06

## What we set out to do
Check RDS/ElastiCache usage on staging to size an instance for a planned load test, then destroy staging to stop the cost. Discovered staging's API was completely down (0 healthy targets), so this turned into a deploy-pipeline repair session. Prod was never modified directly — only read-only checks were done against it, and the one auto-triggered prod deploy (normal CI/CD side effect of pushing to `main`) completed successfully on its own.

## Original sizing data (still valid for the next attempt)
- RDS: `db.t4g.small`, 20GB gp3, 3000 IOPS — ~3.65GB used of 20GB (idle, schema+seed only)
- ElastiCache: `cache.t4g.micro` — ~6.8MB used of ~537MB (idle)
- Both already match prod's sizing (staging is deliberately provisioned identically per CLAUDE.md)
- **Caveat unchanged**: these are idle-baseline numbers, not load-tested numbers — a real load test never ran

## Fixed and merged to `main` (durable, still valid)
1. **IAM role drift** — `ocar-staging-ec2-role` had zero policies attached in AWS despite Terraform defining them; state was also missing `aws_db_instance.main` entirely (would have tried to create a duplicate RDS instance). Fixed via `terraform import` + `terraform apply`.
2. **`deploy.yml` schema bug** — `env` context isn't valid in `jobs.<job_id>.environment`/`.concurrency`/`.env`; broke the whole workflow file (including prod's normal auto-deploy) until fixed.
3. **Enabled staging deploys** — added `workflow_dispatch` path to `deploy.yml`, parameterized IAM trust policy per-environment, added 2 missing GitHub repo variables (`STAGING_ALB_DNS_NAME`, `STAGING_GHA_DEPLOY_ROLE_ARN`).
4. **One-time SSM bootstrap** — `/ocar/staging/active-color`, `blue/image-tag`, `green/image-tag` created (never existed; Terraform never manages these, matches prod's own history).
5. **`refresh-postgres-exporter-secret.sh` (new script, 3 real bugs found and fixed in it):**
   - CRLF in `.env.prod` broke `source` under `set -e`, silently preventing the API container from ever starting
   - `.env.prod` doesn't define `AWS_REGION` — passed explicitly instead
   - `.env.prod` doesn't define `DB_SECRET_ARN` — now derived fresh from RDS (same pattern `deploy.yml`'s own migration step already uses, added one scoped `rds:DescribeDBInstances` IAM permission for it)

All five commits are on `main` and will carry forward to the next staging attempt automatically.

## Where it stopped
6th deploy attempt failed with a **4th bug in the same script**: `.env.prod` also doesn't define `DB_HOST` (`DB_HOST: unbound variable`), despite `docker-compose.prod.yml`'s own comment assuming it would be there. Per your call, stopped fixing at this point rather than continuing to iterate.

**Likely underlying issue, for whoever picks this up:** `/ocar/staging/api-env` (the manually-maintained SecureString `.env.prod` source) appears to be missing several keys prod's copy has (`AWS_REGION`, `DB_SECRET_ARN` was never expected either way, `DB_HOST`, possibly more). Worth diffing staging's `api-env` content against prod's `api-env` content directly rather than continuing to patch the script reactively — there may be a whole class of missing keys, not just one at a time.

## Also found, unrelated to any of the above
- **AWS account vCPU quota is 16** for the relevant On-Demand instance family. Staging's own instance churn (repeated ASG-driven replacement across failed attempts) briefly consumed most of it; had to scale staging's `blue` color down mid-session to make room for `green` to launch. Not a code bug — worth knowing before the next attempt, since a full staging + prod footprint can get close to this ceiling.
- **A pre-existing RDS tag mismatch** was corrected in the same Terraform apply: the staging DB instance (`ocar-staging-db`, confirmed distinct from `ocar-prod-db`) was tagged `Environment: prod` / `Name: ocar-prod-db` — cosmetic, but worth knowing it happened, likely a leftover from the Neon→RDS migration.

## Staging environment: destroyed
`terraform destroy` ran clean — 48 resources removed, confirmed gone (RDS, ElastiCache, ASGs, ALB, VPC all verified empty via AWS CLI after).

**Leftover, NOT cleaned up** (these were never Terraform-managed, so `destroy` doesn't touch them — negligible cost, but exist until manually deleted):
```
/ocar/staging/api-env
/ocar/staging/ghcr-token
/ocar/staging/active-color
/ocar/staging/blue/image-tag
/ocar/staging/green/image-tag
/ocar/staging/image-tag
```

## Suggested next steps (for the morning)
1. Diff `/ocar/staging/api-env` against `/ocar/prod/api-env` for missing keys (`AWS_REGION`, `DB_HOST` at minimum) — fix the data, not the script, this time.
2. Re-run `pnpm infra:staging:apply` — all the code/IAM/workflow fixes from this session are already on `main` and will apply cleanly.
3. Once staging boots healthy, either run a real k6 ramp (steps 1-2 from `load-tests/README.md`) for real load-tested sizing numbers, or accept the current prod-matched sizing and skip straight to destroy again.
4. Consider requesting the vCPU quota bump if staging + prod will ever need to run simultaneously at higher instance counts.
