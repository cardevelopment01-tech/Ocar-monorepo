# Load Test Prep — Status & Resume Guide (2026-09-07)

Picking up from `docs/handover/2026-09-06-staging-deploy-investigation.md` (the
overnight session that fixed staging's deploy pipeline). This doc covers what
happened *after* staging became healthy: seeding it for a real k6 load test.

## ⚠️ URGENT — DO THIS FIRST IN THE NEXT SESSION

**Staging RDS is currently PUBLICLY ACCESSIBLE.** This was opened deliberately
to let local seed scripts reach it (see "Why public access" below), but it
was never closed because the token-seed run kept failing. Before anything
else:

```bash
aws rds describe-db-instances --db-instance-identifier ocar-staging-db --query "DBInstances[0].PubliclyAccessible"
```

If `true`, revert both pieces immediately:

```bash
aws rds modify-db-instance --db-instance-identifier ocar-staging-db --no-publicly-accessible --apply-immediately
aws ec2 describe-security-group-rules --filters "Name=group-id,Values=sg-0e81086d4acbb0564" \
  --query "SecurityGroupRules[?FromPort==\`5432\`]"
# revoke whatever CIDR shows up there:
aws ec2 revoke-security-group-ingress --group-id sg-0e81086d4acbb0564 --protocol tcp --port 5432 --cidr <CIDR>
```

The DB currently holds real prod-snapshot data (see below) — do not leave
this open longer than necessary.

---

## What's actually done

1. **Staging environment**: fully destroyed and rebuilt tonight, genuinely
   healthy, running on RDS (confirmed via `docker exec ocar_api printenv
   DB_HOST DB_AUTH_MODE` → `ocar-staging-db...rds.amazonaws.com` /
   `secrets-manager`). ALB DNS is now
   `ocar-staging-alb-436657015.ap-south-1.elb.amazonaws.com` (changed from the
   pre-rebuild one — update any saved BASE_URL).
2. **Real data restored**: a prod DB snapshot (`ocar-staging-seed-20260903-1027`)
   was restored to a temp instance, transferred into staging's real RDS via
   `pg_dump | psql` over SSM, then the temp instance was deleted. Staging now
   has 77 real users, 243 real rides, 179 real drivers, 37 real payments.
3. **Driver vehicles activated**: the restored drivers' `driver_vehicles` were
   stuck at `status='pending'` (never admin-approved in the snapshot). Fixed
   via `load-tests/seed/activate-restored-driver-vehicles.js` — 144 vehicles
   now `active`.
4. **Bulk synthetic ride history seeded**: 1,000,000 rides, 4,399,568
   `ride_status_history`, 1,000,000 `fare_snapshots`, 799,856 `payments` — for
   query-performance-at-volume testing (separate axis from the k6 concurrency
   test — see `docs/superpowers/specs/2026-08-31-load-test-seed-data-spec.md`).
   Storage after seeding: ~5.1 GB / 20 GB (~25%). Memory: stable, no runaway
   pressure. CPU credits: healthy/flat throughout.
5. **`DATABASE_URL` removed from all load-test tooling.** It was found
   pointing at the pre-migration Neon database the whole session — every seed
   script now derives the RDS connection live via the new
   `load-tests/seed/lib/staging-db.js` helper (shells out to `aws rds
   describe-db-instances` + `aws secretsmanager get-secret-value`, hardcoded
   to staging only). Updated: `generate-test-tokens.js`,
   `generate-bulk-ride-history.js`, `verify/reconcile.js`,
   `verify/query-regression.js`, `README.md`. This is committed and durable —
   don't reintroduce `DATABASE_URL` to these scripts.
6. **All infra/pipeline fixes from the overnight session are committed to
   `main`** (IAM role drift, Terraform state import, `deploy.yml` schema bug,
   SSM bootstrap, 3 bugs in `refresh-postgres-exporter-secret.sh`, reusable
   temp-restore-credential infra). Nothing here needs redoing.

## What's NOT done — the actual remaining blocker

**The 50,000-rider token seed never completed successfully.** Sequence of
events:
- First run (6,000 users) succeeded early in the session, but against the
  wrong DB (Neon) — irrelevant now.
- After fixing `DB_AUTH_MODE`, re-ran targeting the real count (50,000).
  Reached 20,961 rows in the DB, then **I killed the connection myself** by
  reverting the temporary public-access opening while the script was still
  running (RDS's `--no-publicly-accessible` change drops live connections,
  not just new ones).
- Re-opened public access, retried — hit `ETIMEDOUT` on a security-group
  IP mismatch (my sandbox's IP ≠ the user's actual terminal IP; never fully
  resolved before the session ended on context length).

**Because `generate-test-tokens.js` only writes `k6/tokens.json` at the very
end of a successful run, the file currently on disk is still the STALE
6,000-user, 0-driver version from before any of tonight's fixes.** Do not run
k6 yet — it would use that stale file.

## Exact next steps to resume

1. Close public RDS access if still open (see URGENT section above).
2. Re-open it the same way (tightly scoped, single IP) — **but first have
   the user confirm their actual current public IP from their own terminal**
   (`Invoke-RestMethod https://checkip.amazonaws.com` in PowerShell), not
   from Claude's sandbox — they may differ (proxy/VPN artifacts were seen).
3. Re-run the token seed to completion:
   ```powershell
   $env:JWT_ACCESS_SECRET = (aws ssm get-parameter --name /ocar/staging/api-env --with-decryption --query "Parameter.Value" --output text) -split "`n" | Select-String '^JWT_ACCESS_SECRET=' | ForEach-Object { $_.ToString().Split('=',2)[1] }
   node seed/generate-test-tokens.js --users 50000 --drivers 400 --expiry 3h
   ```
   **Do not interrupt this or touch RDS public-access settings while it's
   running.** It's not resumable/checkpointed — an interruption means a full
   re-run from scratch (it upserts every index 0..N-1 every time).
4. Once it prints `Wrote ./tokens.json`, close public access again
   immediately (same revert commands as the URGENT section).
5. Confirm real `tokens.json` contents: should show ~50,000 users and up to
   400 drivers now (144 available with active vehicles).
6. Then genuinely ready for k6:
   - `BASE_URL=https://ocar-staging-alb-436657015.ap-south-1.elb.amazonaws.com`
   - `WS_URL=wss://ocar-staging-alb-436657015.ap-south-1.elb.amazonaws.com`
   - Needs `--insecure-skip-tls-verify` (k6 flag) — the ACM cert is for
     `staging.ocar-api.clienttesting.in`, not the raw ALB hostname.
   - `CATEGORY_ID=1` (hatchback), `CITY_ID=1` (Bhubaneswar) — confirmed real.
   - Alloy logs pipeline confirmed live (6h uptime, shipping cleanly, zero
     errors). Metrics/traces pipeline was **not** independently verified —
     open Grafana yourself and confirm panels show recent data before the
     real run (per `load-tests/README.md` §5's own instruction).
   - Run `smoke.js` first now that driver tokens will actually exist.

## Why public RDS access was needed at all (context for later)

Staging RDS is `PubliclyAccessible: false` by design — the app and all
verified DB work tonight went through SSM on an EC2 instance already inside
the VPC. The seed scripts, though, are meant to be run from a developer's own
laptop (matching the documented workflow), which has no VPC network path to
RDS. Opening public access temporarily (scoped to one IP, security-group rule
tagged `Purpose=temp-load-test-seeding-REMOVE-AFTER` for easy identification)
was a deliberate, explicit tradeoff the user chose after being told the safer
alternative (run seed scripts via SSM instead) — documented here so a future
session doesn't have to re-litigate it, but also doesn't forget to close it
promptly every time.

## Key facts / gotchas worth remembering

- **RDS host**: `ocar-staging-db.ct8umsw42czk.ap-south-1.rds.amazonaws.com`
  — this hostname has stayed stable across the destroy/rebuild tonight, but
  don't assume that always holds; re-check via `terraform output rds_endpoint`
  after any future rebuild.
- **`api-env` is NOT Terraform-managed** — a manually-maintained SSM
  SecureString. Editing it means pulling the whole blob, editing one line,
  pushing the whole blob back (see CLAUDE.md's Pending Ops Actions — this
  pain point is exactly why it's error-prone).
- **PowerShell gotcha, already hit once tonight**: capturing multi-line
  external-command output via `$content = command args` can silently collapse
  newlines into spaces if handled carelessly downstream — always verify line
  count (`($x -split "\`n").Count`) before writing back, or use `--output
  json | ConvertFrom-Json` instead of `--output text` for anything
  multi-line.
- **AWS account vCPU quota is 16** for the relevant instance family — staging
  + prod running simultaneously at higher instance counts can get close to
  this.
- **Never reintroduce `DATABASE_URL`** to any load-test script — it's the old
  Neon pointer, now fully removed from the codebase's load-test tooling.
