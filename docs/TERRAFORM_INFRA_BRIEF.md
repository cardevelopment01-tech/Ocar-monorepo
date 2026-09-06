# Terraform Infra Session — Brief for Claude Code

**Status: SUPERSEDED (2026-09).** This was the pre-build planning brief, pasted into
a Claude Code session before any of this infrastructure existed. Nearly everything
in "Current production setup" and "Target architecture" below describes either the
old single-EC2 box or an early single-ASG plan, neither of which matches what was
actually built. For the current, accurate state (blue/green ASGs, AWS RDS, AWS
ElastiCache Valkey, S3-backed Terraform state, full CI/CD flow), see the dedicated
deployment architecture document instead. Kept here for history only — do not use
this file as a source of truth, and do not "correct" the live `.tf` files to match
it.

---

Paste this whole file as your first message in a Claude Code terminal session, in the
`cab-booking-platform` repo root. It gives Claude Code full context so you don't have
to re-explain the plan from scratch.

---

## Your role in this session

Research first, then build collaboratively — not solo.

1. **Before writing any Terraform**, research current (2026) best practices for the
   specific pieces of this architecture: Terraform AWS provider version pinning, VPC/subnet
   design for a public-subnet EC2 fleet behind an ALB (no NAT gateway), ALB + ACM
   certificate setup, Auto Scaling Group target-tracking scaling policies, Launch
   Template `user_data` patterns for pulling a Docker image from GHCR at boot, IAM
   instance-profile least-privilege patterns for reading AWS SSM Parameter Store, and
   Terraform local-vs-S3 state management. Ground what you write in current official
   docs, not just training data.

2. **Working style — this is a paired-learning session, not a "get it done" session.**
   I (Sujal) am writing most of the Terraform files myself so I actually learn AWS and
   Terraform, not just end up with working files I can't explain. For each phase below:
   explain the concept and give me a clear spec/checklist of what the file needs to
   contain — do **not** write the file for me by default. I'll write it and paste it
   back for you to review line by line. If I get stuck and explicitly tell you to write
   a piece yourself, do it — but always follow up by explaining what specifically I got
   wrong and why, not just silently fixing it.

3. **Never run `terraform apply` against real AWS without me explicitly confirming
   first**, and never ask me to paste AWS access keys/secrets into the terminal or
   chat — credentials go through my local AWS CLI config or GitHub Actions OIDC, not
   pasted text.

---

## The system this infra is for

Cab booking platform ("Ocar") for Odisha (Bhubaneswar/Cuttack/Puri). Turborepo/pnpm
monorepo: `api/` (Express + TypeScript backend), `apps/user`, `apps/driver`,
`apps/admin` (frontends, deployed separately via Vercel — not in scope here). Full
system details are in `CLAUDE.md` at the repo root if you need them.

### Current production setup (what exists today, before this session)
- One EC2 instance (Ubuntu, AWS) running Docker Compose: the API container, nginx
  (reverse proxy + TLS via Let's Encrypt/certbot), and a monitoring stack (Prometheus,
  Grafana, node-exporter, cAdvisor feeding Grafana Cloud via Alloy).
- Deploy pipeline: GitHub Actions. `ci.yml` runs lint/typecheck/tests on every push.
  `deploy-api.yml` builds the Docker image, pushes to GitHub Container Registry (GHCR)
  tagged by git SHA, then SSHes into the one EC2 instance, runs migrations in an ad-hoc
  container gating the cutover, swaps the container, health-checks `/health`, and
  auto-rolls-back to the previous image tag on failure.
- Database: PostgreSQL + PostGIS, managed, on **Neon** (serverless Postgres, supports
  instant copy-on-write branching — relevant later for the staging environment).
- Cache/queues: **Redis Cloud** (managed), used directly and via BullMQ for background
  workers (notifications, ride dispatch/broadcast, GPS flush, settlements, etc.) — the
  workers currently run inside the same Node process as the API server, not split out.
- Real-time: Socket.io. **Already has the Redis adapter wired in** (`@socket.io/redis-adapter`
  in `api/src/websocket/socket.server.ts`) specifically so events broadcast correctly
  across multiple API instances — this prerequisite for horizontal scaling is already done.
- Domain: `ocar-api.clienttesting.in`, DNS managed externally (not necessarily Route 53
  — check before assuming).
- Region: **ap-south-1** (Mumbai) — matches the existing S3 bucket and Neon region.

### Why we're doing this
A client-side reviewer (22 years experience) correctly identified that the current
single-EC2 setup has no mechanism to add capacity automatically under load, and no
redundancy if that one instance dies. The goal is NOT enterprise/Kubernetes scale — the
realistic target is **~20,000 users/day**, which by rough estimation is a few hundred
concurrent active rides at peak and a few thousand concurrent WebSocket connections —
well within what 2 modern EC2 instances can handle. The architecture below is sized
honestly for that number, not over-built.

---

## Target architecture (what we're building)

```
Internet
   │
   ▼
ALB (public subnets, terminates TLS via free ACM cert)
   │
   ▼
Target Group (health check on /health)
   │
   ▼
Auto Scaling Group — min 2 / desired 2 / max 4
   │  target-tracking scaling policy (CPU or ALB request count per target)
   ▼
EC2 instances × 2-4, in PUBLIC subnets (deliberately — see below),
security-group-restricted to accept traffic only from the ALB's security group.
Each instance: Docker running the API container, launched from a Launch Template
whose user_data boot script installs Docker, reads the current image tag from
SSM Parameter Store, authenticates to GHCR, pulls, and runs the container —
zero SSH required for a new instance to become healthy.
   │
   ▼
Neon Postgres (managed, external) + Redis Cloud (managed, external)
```

**Deliberate simplifications, decided with reasoning, not by accident — don't
"correct" these back to a more complex default without discussing it first:**
- **No NAT gateway, no private subnets.** EC2 instances sit in public subnets, but a
  security group only allows inbound from the ALB's security group — nothing on the
  internet can reach them directly. A NAT gateway (~$32-45/month + data fees) buys
  marginal extra isolation not worth the cost at this scale. Revisit only if a real
  compliance requirement demands private subnets later.
- **No Kubernetes.** ALB + ASG + Launch Template solves the actual problem (automatic
  capacity, zero-SSH bootstrapping) without the operational overhead of a K8s control
  plane for a fleet that will realistically run 2-4 nodes.
- **No Ansible (yet).** The Launch Template's `user_data` script handles the full
  bootstrap (install Docker, pull image, run it). Only reconsider Ansible if that
  script becomes unmanageably complex — don't add it preemptively.
- **Staying on GitHub Actions, not Jenkins**, per earlier discussion with the client —
  GitHub Actions supports OIDC federation with AWS (short-lived credentials, no static
  keys in secrets), which is a genuine security upgrade over typical Jenkins+static-key
  setups, and avoids taking on a second CI system to operate.
- **Local Terraform state for now, not S3.** Get the whole thing applying successfully
  from a local state file first. Migrate to an S3 backend (with native S3 locking, not
  the older DynamoDB pattern) only once this is proven working — trying to debug
  Terraform and a remote backend simultaneously on day one is unnecessary friction.

---

## Build roadmap — work through in this order (real dependency order, not arbitrary)

1. **`providers.tf` + `variables.tf`** — Terraform/AWS provider block (pin `~> 5.0`),
   variables for region (`ap-south-1`), environment, project name, domain name, VPC
   CIDR (`10.0.0.0/16`), 2 AZs (`ap-south-1a`, `ap-south-1b`), 2 public subnet CIDRs
   (`10.0.0.0/24`, `10.0.1.0/24`), instance type (`t3.small`).
2. **VPC + 2 public subnets + Internet Gateway + route table.** No NAT gateway.
3. **Security groups.** ALB SG (80/443 from `0.0.0.0/0`), EC2 SG (only from the ALB
   SG, plus optionally SSH from one specific IP for debugging).
4. **ACM certificate** for `ocar-api.clienttesting.in`, DNS-validated — output the
   validation CNAME record for manual DNS setup (confirm first whether DNS is on
   Route 53 or an external registrar; that changes whether validation can be automated).
5. **IAM role + instance profile** — permission for EC2 instances to read the SSM
   Parameter Store value holding the current image tag. Least privilege — don't grant
   broad EC2/IAM permissions to the instance role.
6. **Launch Template**, including the `user_data` boot script: install Docker,
   authenticate to GHCR, read the image tag from SSM, pull and run the container,
   surface a way for the ALB health check to see it's ready.
7. **ALB + target group + listeners** — HTTPS listener using the ACM cert, HTTP→HTTPS
   redirect listener, target group health-checking `/health`.
8. **Auto Scaling Group** — references the launch template and target group, min
   2/desired 2/max 4, target-tracking scaling policy.
9. **`outputs.tf`** (ALB DNS name, etc.) — then a full `terraform fmt` + `terraform
   validate` pass across everything before any apply.
10. **First real `terraform apply`** (from local machine, real AWS credentials, only
    after explicit go-ahead) — verify the ALB is routing traffic correctly *before*
    touching DNS. Plan the actual cutover from the single EC2 to this new architecture
    with a lowered DNS TTL ahead of time so the switch is fast to reverse if needed.

## What comes after this Terraform work (not in scope for this session, but context)
- `deploy-api.yml` needs to change from "SSH into one box" to "update the SSM image-tag
  parameter and trigger an ASG Instance Refresh."
- Once production is proven, the exact same `.tf` files get applied a second time with
  different variables (`environment = "staging"`, one instance instead of two, separate
  state key) to stand up a staging/stress-test environment, paired with a Neon database
  branch and a k6 load-testing script against realistic traffic (ride booking flow +
  GPS ping frequency).
- Terraform state eventually migrates to an S3 backend, and `plan`/`apply` eventually
  moves into its own GitHub Actions workflow using OIDC — not in scope until the above
  is working end-to-end.
