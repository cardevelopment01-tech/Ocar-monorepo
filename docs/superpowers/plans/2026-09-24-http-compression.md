# HTTP Compression Plan — gzip / Brotli / zstd

**Date:** 2026-09-24 · **Status:** Proposed · **Scope:** API (Express on ASG behind ALB), 3 web apps (Vercel), 2 Expo apps, infra

---

## 1. TL;DR

| Layer | Today | Action | Algorithm |
|---|---|---|---|
| **API JSON (prod, ALB → api:4000)** | **Uncompressed.** ALB never compresses; nginx (which could) is gone on the ASG path | **Add `compression` middleware** — the only real change | Brotli q4 → gzip fallback |
| Web apps (user/admin/driver on Vercel) | Vercel CDN already negotiates Brotli/gzip | Nothing. Verify only | Brotli (Vercel's choice) |
| Socket.io | `perMessageDeflate` off (default), websocket-only | Keep off | none |
| Mobile apps → API | Axios on RN; OS HTTP stack sends `Accept-Encoding` (no manual header anywhere, so OkHttp/URLSession decode transparently) | Nothing in app code. Benefits automatically from API change | gzip (Android OkHttp), br/gzip (iOS) |
| Mobile bundled images | 14 PNGs, 17.5 MB (onboarding, login hero, vehicle icons) | **Done:** WebP, same dimensions, 0.82 MB total | WebP (lossy, alpha kept) |
| Driver-mobile photo uploads | Full-res 12MP JPEG (~2–4 MB); picker `quality` never shrinks dimensions | **Done:** `services/uploadImage.ts` downscales to 1600px / q0.82 in all 3 upload functions, parity with web | JPEG |
| Redis / BullMQ values | All tiny (<100 B: OTP state, ack flags, IDs) | Don't compress | none |
| S3 uploads | JPEG already client-downscaled (`compressDocImage`) | Don't compress | none |
| RDS Postgres | defaults | Optional, measured: `wal_compression = zstd` | zstd |
| Metrics archive script | gzip | Leave it | gzip |

**One-line summary:** the single high-value move is response compression in Express. zstd has no worthwhile HTTP role for us today. Details on why below.

---

## 2. What the research says (Context7, current docs)

**`compression` (expressjs/compression, v1.8.x)**
- Supports `gzip`, `deflate`, **and Brotli** (`br`) natively. **No zstd.**
- Options that matter: `threshold` (default `1kb`), `level` (gzip, default -1 ≈ 6), `brotli.params[BROTLI_PARAM_QUALITY]` (default **4** — a deliberate on-the-fly quality; 11 is for precompressed static files only), `filter(req,res)`.
- `res.flush()` exists for SSE/streaming. We have no SSE/streaming responses in `api/src` (checked) so not needed.

**Node.js `zlib` (v22.x)**
- `zlib.createZstdCompress()` exists (added 22.15, **experimental**). Our runtime: `node:22.16-alpine` (api/Dockerfile) → available, but experimental, and no Express middleware uses it.

**Vercel CDN**
- Automatically negotiates **Brotli or gzip** for HTML/CSS/JS/JSON; Brotli preferred (14–21% smaller than gzip). No zstd listed. Nothing to configure.

**Next.js `compress`**
- Only applies to `next start`/custom server. On Vercel the CDN compresses; leave `compress` at default. Don't add a build-time `.br`/`.gz` plugin to Vite — Vercel doesn't need it.

**Socket.io v4 `perMessageDeflate`**
- Disabled by default "due to potential performance and memory overhead" (per-connection zlib context). Default threshold 1024 B.

---

## 3. Algorithm cheat-sheet (what to use where)

| | gzip | Brotli | zstd |
|---|---|---|---|
| Client support | Universal (every HTTP client incl. OkHttp, curl, k6) | All browsers; iOS URLSession; **not** Android OkHttp by default | Chrome/Edge 123+, Firefox 126+; **not** Safari (as of our research), not OkHttp, not iOS URLSession |
| Ratio on JSON | baseline | ~15–25% smaller than gzip at q4–5 | ≈ Brotli-q4 at level 3 |
| Speed (dynamic) | fast | q4 ≈ gzip-6 speed; **q≥9 is 10–50× slower — never on the fly** | fastest compress + decompress |
| Best use | Fallback for everything | Dynamic text to browsers/iOS (q4), static assets precompressed (q11) | Server-to-server / storage / logs / WAL / backups, where you control both ends |

**Rule of thumb:** browsers → Brotli; universal fallback → gzip; zstd → places where you own both ends (storage, internal pipelines). HTTP-level zstd only pays off at CDN scale with dictionaries — not our stage.

---

## 4. Why zstd isn't in the HTTP path (explicit decision)

1. `compression` middleware doesn't support it → we'd hand-roll content negotiation. That's more code to own for little gain.
2. Our biggest API consumers are the **Expo apps**. Android's OkHttp only does gzip transparently, so zstd would never be picked there.
3. For our payload sizes (1–50 KB JSON), zstd-3 vs Brotli-4 differ by single-digit %. The network win is already captured by Brotli.
4. Node's zstd is still experimental in 22.x.

**Revisit when:** zstd graduates from experimental in Node LTS **and** `compression` (or a maintained fork) ships zstd **and** a measurable share of traffic is Chromium browsers hitting the API directly (admin/user web).

---

## 5. The change — API response compression

### 5.1 Why this is the big one
- Prod path is **client → ALB (TLS) → api:4000**. AWS ALB **doesn't compress**. The old nginx box has no `gzip on` either. So every JSON response ships raw today.
- Admin list pages (drivers/rides/users, paginated), analytics payloads, ride history, route/geometry data and notification feeds are repetitive JSON: expect **70–90% size reduction**.
- Riders/drivers are on Indian 3G/4G in Odisha. Bytes on the wire dominate latency more than server CPU.

### 5.2 Implementation (≈15 lines, one dependency)

`cd api && pnpm add compression && pnpm add -D @types/compression`

In `api/src/app.ts`, register **after** metrics/logging and **before** routes (next to `helmet()`):

```ts
import compression from 'compression'
import zlib from 'node:zlib'

// 2b. Response compression. The ALB doesn't compress, so this is the only
// layer that can. Brotli q4 is the on-the-fly sweet spot (q>=9 is for
// precompressed static files); gzip fallback covers Android OkHttp.
app.use(compression({
  threshold: 1024,
  brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
  filter: (req, res) => {
    // Auth responses carry tokens next to request-reflected input (phone,
    // email) — skip to rule out BREACH-style length oracles. They're <1 KB anyway.
    if (req.path.startsWith('/api/v1/auth')) return false
    // Scraped over localhost by Alloy; compressing only burns CPU.
    if (req.path === '/metrics' || req.path === '/health') return false
    return compression.filter(req, res)
  },
}))
```

Nothing else changes: `res.json()` everywhere gets it for free, `Vary: Accept-Encoding` is set by the middleware, and all clients (axios in browser/RN, OkHttp, URLSession) decompress transparently.

### 5.3 Decisions & their reasons
| Decision | Why |
|---|---|
| Brotli **q4**, not 11 | q11 compresses dynamic JSON ~30–50× slower. The API has `cpus: 1.5` per container. q4 ≈ gzip-6 CPU for ~15–20% smaller output |
| gzip default level | Default (~6) is the standard ratio/CPU knee |
| `threshold: 1024` | Below ~1 KB, headers + framing overhead cancel the gain. Most ride-status/ack responses stay raw |
| Exclude `/api/v1/auth/*` | BREACH defence-in-depth: admin auth uses a cookie, and auth bodies hold tokens. Costs nothing, they're tiny |
| Exclude `/metrics`, `/health` | Localhost scrape / ALB health checks: no network to save |
| App-level, not CloudFront in front of ALB | CloudFront would add a cost line, a second TLS hop, WebSocket config and cache rules for **uncacheable** authenticated JSON. Revisit only if we add cacheable public endpoints |
| Keep in-process (not an nginx sidecar) | ASG instances deliberately dropped nginx. Re-adding a proxy just for gzip reverses that |

### 5.4 Risks
- **CPU:** Brotli q4 on a 20 KB JSON costs ~0.2–0.5 ms. It's watched via the existing `http_request_duration_seconds` p95 and container CPU in Grafana. If CPU becomes the bottleneck, drop to `BROTLI_PARAM_QUALITY: 3` or raise the threshold. Don't remove compression.
- **Razorpay webhook:** request-side only (`express.json` `verify` uses raw *request* bytes). Unaffected.
- **Multer uploads:** request-side. Unaffected.
- **Socket.io:** bypasses Express middleware (upgrade on the http server). Unaffected.

---

## 6. Explicit non-goals (and when to revisit)

| Not doing | Reason | Revisit when |
|---|---|---|
| Socket.io `perMessageDeflate` | Our events (location pings, ride status, chat) are ≪1 KB, and per-socket zlib state costs RAM across thousands of driver connections | An event type routinely exceeds ~4 KB (e.g. pushing full route polylines over sockets) |
| Redis/BullMQ value compression | Values are flags, IDs and OTP state (tens of bytes) | We cache large JSON blobs (≥10 KB) in Redis |
| Request-body compression (client → API) | Bodies capped at 100 KB, mostly <2 KB. Uploads are JPEGs already downscaled client-side | Never likely |
| zstd over HTTP | See §4 | See §4 |
| Precompressed static assets (vite-plugin-compression, `.br` files) | Vercel CDN compresses and caches itself | We move web hosting off Vercel to S3/CloudFront or nginx |
| Compressing S3 objects | Images/PDFs are already compressed formats | We store JSON/CSV exports in S3 |

---

## 7. Optional, infra-only: Postgres `wal_compression = zstd`

PG15+ supports `wal_compression = zstd`. It shrinks full-page writes in WAL, so it reduces WAL volume, replication/backup I/O and storage. We're on PG 18 on RDS with a custom parameter group (`infra/terraform/rds.tf` → `aws_db_parameter_group.main`). This is where zstd actually earns its keep for us.

```hcl
parameter {
  name  = "wal_compression"
  value = "zstd"
}
```
Dynamic parameter, so no reboot. **Gate it:** only if the RDS `TransactionLogsGeneration` / WAL-related CloudWatch metrics show meaningful volume. Otherwise it's a no-op knob. Ships through the normal staging → prod Terraform flow (see `deploy-ops` skill).

---

## 8. Rollout & verification

1. **Implement** (§5.2) + one test in `api/tests/unit/` or integration using supertest:
   - `GET` a >1 KB JSON route with `Accept-Encoding: br` → `content-encoding: br`
   - same with `Accept-Encoding: gzip` → `gzip`
   - `/api/v1/auth/...` and `/health` → no `content-encoding`
   - Verify: `cd api && pnpm test && npx tsc --noEmit`
2. **Baseline before deploy** (staging): record sizes for 5 representative endpoints (admin rides list, admin drivers list, analytics, user ride history, notifications feed):
   `curl -s -o /dev/null -w "%{size_download}\n" -H "Authorization: Bearer $T" -H "Accept-Encoding: br" <url>` vs without the header.
3. **Load test** with the existing k6 suite (`load-tests/k6/main.js`). Set `Accept-Encoding: gzip, br` explicitly in params so it reflects real clients. Compare p95 latency + container CPU against the last `summary.json`.
4. **Deploy** via normal blue/green. Watch `http_request_duration_seconds` p95 and CPU for 24h.
5. **Mobile check:** on an Android device, confirm an API response arrives with `content-encoding: gzip` (Flipper/Charles, or log `response.headers` in dev).

**Success criteria:** ≥60% reduction in bytes on the 5 baseline endpoints; p95 latency no worse (expect better on real mobile networks); API container CPU increase <10%.

**Rollback:** remove the `app.use(compression(...))` line and redeploy. Stateless, no data implications.

---

## 9. Effort

| Item | Effort |
|---|---|
| §5 middleware + test | ~1 hour |
| §8 baseline + k6 + deploy watch | ~half day, mostly waiting |
| §7 WAL zstd (optional) | 15 min Terraform + staging apply |
