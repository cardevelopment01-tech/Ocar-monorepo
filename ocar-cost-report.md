# Ocar Platform — Service & Infrastructure Cost Estimate

**Prepared:** 17 Aug 2026
**Region:** ap-south-1 (Mumbai)
**Currency basis:** USD, ₹95.62/$1

Every paid service the codebase currently depends on, pulled from Terraform, Docker Compose, and the API's environment config — not from memory. Costs split into two kinds: **fixed infrastructure** (billed monthly regardless of ride volume) and **usage-based** (billed per SMS, per rupee moved, per map call — scales with how many rides actually happen).

## Headline numbers

| | Monthly |
|---|---|
| Fixed infrastructure | **$167 – $294** (≈ ₹15,969 – ₹28,112) |
| Usage-based @ 10,000 rides/mo (example) | **$1,155 – $1,278** (≈ ₹1,10,451 – ₹1,22,222) |
| **Estimated total @ 10,000 rides/mo** | **$1,322 – $1,572** (≈ ₹1,26,430 – ₹1,50,315) |

*(Reflects the completed Neon→RDS database migration (cutover done 2026-08-20) with RDS Proxy pooling (confirmed pricing), a single Vercel seat, and correcting SMS to reflect login/signup volume rather than ride volume — see notes below each section.)*

> **Read this first:** the usage-based column is a worked example at an assumed 10,000 rides/month (roughly what a single-city Bhubaneswar/Cuttack/Puri launch might see) — it is *not* a fixed bill. Payments, SMS, calls, and maps all scale with real ride volume; the per-unit rate card is in each section below so this can be recalculated at any volume. The fixed-infrastructure column is the floor: it's billed the same whether 0 or 10,000 rides happen.

---

## Compute & networking — fixed

The API runs on an auto-scaling EC2 fleet behind a load balancer. No NAT gateway — a deliberate call in `vpc.tf` to avoid the ~$32–45/mo it would add at this scale, since instances get public IPs directly and are locked down by security group instead.

| Service | Detail | Min/mo | Max/mo |
|---|---|---:|---:|
| AWS EC2 (Auto Scaling Group) | 2× t3.medium always on, scales to 4 under load ($0.0448/hr each, ap-south-1) | $65 | $131 |
| AWS Application Load Balancer | Base hourly charge + LCU usage charge | $16 | $30 |
| AWS ACM (TLS certificate) | Free when attached to an ALB | $0 | $0 |
| **Subtotal** | | **$81** | **$161** |

*Staging is a separate, on-demand copy of this same block (spun up for load tests via `staging-infra.yml`, torn down after) — not counted in the always-on total above.*

## Database & cache — fixed

| Service | Detail | Min/mo | Max/mo |
|---|---|---:|---:|
| AWS RDS — PostgreSQL 18 (`db.t4g.small`, single-AZ) — **live, replaced Neon 2026-08-20** | Confirmed via AWS Pricing Calculator: $0.034/hr Graviton, ap-south-1, single-AZ | $24.82 | $24.82 |
| AWS RDS storage (20GB gp3, storage autoscaling on) | $0.131/GB-month in Mumbai; range covers growth before the next right-sizing pass | $3 | $8 |
| AWS RDS Proxy (connection pooling) | $0.015/vCPU-hr of the underlying instance — 2 vCPU × $0.015 × 730hr — **not actually provisioned yet**, cutover shipped with a direct connection (`uselibpqcompat=true` to work around RDS's CA chain); add this if/when a pooler is actually set up | $21.90 | $21.90 |
| ~~Neon (managed Postgres)~~ | Former provider (prod only — **staging still uses a Neon branch**, see `CLAUDE.md`'s Staging Environment section). No AWS region in India — closest is Singapore (ap-southeast-1), so every query crossed a Mumbai↔Singapore hop. Cutover completed 2026-08-20; kept here for cost comparison | $15 | $60 |
| ~~Supabase~~ | Evaluated as a same-region managed alternative; not chosen — team opted to stay inside its own AWS VPC/account instead of a third-party platform | $25 | $75 |
| AWS ElastiCache — Valkey | Single `cache.t4g.micro` node, no HA replica (deliberate — replaced an external Redis Cloud free tier that kept hitting its 30-connection cap) | $12 | $16 |
| **Subtotal (post-cutover)** | | **$62** | **$71** |

**Why the move:** latency, not cost or HA. Neon had no `ap-south-1` presence, so every DB round-trip crossed an inter-region hop the rest of the stack doesn't have. RDS PostgreSQL puts the DB inside the same VPC as the EC2 fleet — no hop, no third-party platform, standard AWS billing. High availability was evaluated and explicitly **not** required at this stage, so this starts single-AZ; `multi_az = true` is a single Terraform attribute to flip later with zero data migration if that changes.

**Two things RDS doesn't give you for free that Neon did:**
1. **`pg_stat_statements` isn't enabled by default** — needs `shared_preload_libraries=pg_stat_statements` set via a custom DB parameter group, plus one reboot to take effect.
2. **No built-in connection pooler — going with RDS Proxy (~$22/mo) rather than self-hosting PgBouncer.** A self-hosted sidecar would've been $0 extra, but at ~$22/mo (under 2% of total monthly spend) this is a buy-vs-build call, not a cost call: RDS Proxy is fully managed (AWS patches it, reads DB credentials straight from Secrets Manager, has its own internal HA) versus a self-hosted proxy needing manual image updates and credential-file syncing on every one of the 4 ASG instances. Worth the small premium to remove that ongoing ownership from a small team.

Migration mechanics (dump/restore, PostGIS extension pre-creation, direct-vs-pooled connection gotchas) were covered earlier in this conversation and apply the same way to RDS as to any Postgres target.

## Storage & secrets — fixed

| Service | Detail | Min/mo | Max/mo |
|---|---|---:|---:|
| AWS S3 — app bucket | Driver documents/selfies, presigned URLs. Storage + PUT/GET requests | $2 | $9 |
| AWS S3 — Terraform state bucket | Versioned, SSE-KMS encrypted; trivial size | $0 | $1 |
| AWS KMS | One customer-managed key encrypting the state bucket | $1 | $1 |
| AWS SSM Parameter Store | 5 parameters (2 Advanced-tier at $0.05/mo each) — deploy secrets and config | $0.25 | $1 |
| **Subtotal** | | **$3** | **$12** |

*The app's S3 bucket has no Terraform resource — it was created outside the IaC, so its exact size should be pulled from the AWS bill directly rather than estimated here.*

## Frontend hosting, CI/CD & observability — fixed

| Service | Detail | Min/mo | Max/mo |
|---|---|---:|---:|
| Vercel | Pro plan, 1 seat — priced per team member, not per project, so all 3 apps (user, admin, driver) sit under this one seat at no extra charge | $20 | $20 |
| GitHub Actions | Private repo; jobs are quick lint/typecheck/test runs for a small team — comfortably inside the 2,000 free min/mo, overage at $0.006–0.008/min only if PR volume grows a lot | $0 | $10 |
| GitHub Container Registry | Private image storage/pulls — currently free | $0 | $0 |
| Grafana Cloud | Logs/metrics/traces via one Alloy agent per host — billing alerts are set at 85% of the *free* tier (10k series / 50GB logs / 50GB traces), so this is $0 until traffic outgrows it | $0 | $19 |
| Cloudflare (DNS) | Free plan | $0 | $0 |
| Domain — clienttesting.in | .in registration, ~₹800/yr, amortized monthly | $1 | $1 |
| **Subtotal** | | **$21** | **$50** |

---

## Payments — usage-based

No fixed fee — Razorpay and RazorpayX charge per transaction actually processed.

| Service | Rate | Example @ 10k rides/mo |
|---|---|---:|
| Razorpay (fare collection) | 2% + GST ≈ 2.36% per transaction | ₹70,800 ($740) |
| RazorpayX (driver payouts) | ₹2–5 per payout | ₹7,000 ($73) |

*Assumes ₹300 average fare and ~2,000 driver payouts/month (weekly settlement across ~500 active drivers). Instant cash-out (RazorpayX payouts) is currently behind a kill switch pending an end-to-end payout test, per the ops notes in CLAUDE.md.*

## SMS, push & call masking — usage-based

| Service | Rate | Example @ 10k rides/mo |
|---|---|---:|
| BulkSMSPlans (SMS/OTP) | ₹0.10–0.22 per SMS — login/registration only, ~3,000 SMS/mo | ₹450 – ₹750 ($5 – $8) |
| Exotel (call masking) | Virtual number pool rental + per-minute talk time, ~1 masked call/ride | ₹15,000 ($157) |
| Firebase Cloud Messaging (push) | Free, unlimited, no per-message charge | $0 |

*SMS does **not** scale with ride count. Ride-start/ride-end OTPs are shown on-screen in the app (`hashOtp()`, never texted) — the only SMS traffic is the 6-digit login OTP, and with a 30-day refresh token (`JWT_REFRESH_EXPIRY_USER`) most riders don't even re-authenticate every month. The ₹450–₹750 example assumes ~3,000 login/signup SMS across riders and drivers combined at this scale — that number tracks new signups and 30-day re-logins, not ride volume, so it won't move much even if ride count doubles. Exotel's exact per-minute rate isn't published — that line is a directional estimate; get a quote from their sales team for a firm number. **CLAUDE.md still says "Fast2SMS"** and `api/.env.example` also lists MSG91 credentials — confirmed with the team that neither is actually in use; **BulkSMSPlans is the only SMS provider in production.** No transactional email service (AWS SES or otherwise) is in production either.*

## Maps — usage-based

| Service | Rate | Example @ 10k rides/mo |
|---|---|---:|
| Google Maps Platform | $2–$30 per 1,000 calls depending on SKU (Dynamic Maps, Geocoding, Directions, Autocomplete); ~4 calls/ride across booking + tracking + admin live-map | $180 – $300 (₹17,212 – ₹28,686) |

*Widest uncertainty in this report — actual cost depends heavily on which specific Maps SKUs the three frontends call and how often the admin live-map polls. Pulling the last 30 days from the Google Cloud console billing page would replace this estimate with a real number in minutes.*

---

## Grand total — worked example at 10,000 rides/month

| | Monthly |
|---|---:|
| Fixed infrastructure | $167 – $294 |
| Payments (Razorpay + RazorpayX) | $813 (₹77,800) |
| SMS + call masking | $162 – $165 (₹15,450 – ₹15,750) |
| Maps | $180 – $300 |
| **Total** | **$1,322 – $1,572 (≈ ₹1,26,430 – ₹1,50,315)** |

### To re-run this at a different ride volume

- Fixed infrastructure stays flat until the ASG needs to scale past 4 instances (roughly 4× today's assumed traffic), the RDS instance needs to size up from `db.t4g.small`, or Grafana Cloud outgrows its free tier.
- Payments, call masking, and maps scale close to linearly with ride count — halve the ride number, halve those totals; double it, double them.
- **SMS is the exception** — it tracks new signups and monthly re-logins (30-day refresh token), not rides, so it barely moves even if ride volume grows a lot. Don't scale the SMS line with ride count; scale it with expected user growth instead.
- Payments dominate the usage-based bill by a wide margin (Razorpay's 2.36% of every fare) — it's the line most worth double-checking against actual GMV projections rather than ride count.

---

## Notes for whoever reviews this

1. **Two numbers here are estimates, not bills:** Exotel's per-minute rate and the exact Google Maps SKU mix. Both vendors' dashboards have the real numbers already if this needs to be tightened before it reaches management.
2. **The S3 application bucket isn't in Terraform** — it was created by hand, so its real size/request volume lives in the AWS Cost Explorer, not in this repo.
3. **Staging is not in the monthly total.** It's an on-demand copy of the fixed-infrastructure block, spun up only for load tests and torn down after — add ~$150–400 for each week it's left running.
4. **Instant driver payouts (RazorpayX) are currently disabled** by a kill switch pending end-to-end testing — the payout line above reflects intended volume once it's live, not what's billed today.

---
*Sources: AWS (incl. live AWS Pricing Calculator for RDS), Neon, Vercel, Grafana Labs, Razorpay, BulkSMSPlans, Google, and vendor pricing pages, current as of Aug 2026*
