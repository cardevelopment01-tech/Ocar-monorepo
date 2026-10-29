#!/usr/bin/env node
// Safe go-live smoke check for a freshly built environment. Read-only and negative tests only: it never calls an
// endpoint that sends an SMS or push, never creates a ride, payment or payout, and sends no valid credentials unless
// you pass tokens. Run it against the test hostname, never against the live production hostname.
//
//   BASE_URL=https://staging.ocarindia.com node infra/scripts/prd-readiness-check.mjs
//
// Optional (each adds an authenticated section; mint them from the target environment, they are never printed):
//   RIDER_TOKEN=... DRIVER_TOKEN=... ADMIN_TOKEN=...
// Optional for testing straight against the load balancer before DNS exists:
//   BASE_URL=https://<alb-dns> HOST_HEADER=staging.ocarindia.com NODE_TLS_REJECT_UNAUTHORIZED=0 node ...
//
// Exits 1 if any check fails. Full flows (ride lifecycle, payments, realtime, load) are covered by load-tests/k6 and
// the manual matrix in docs/PRD_GO_LIVE_TEST_PLAN.md.

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '')
if (!BASE) {
  console.error('Set BASE_URL, for example https://staging.ocarindia.com')
  process.exit(2)
}
if (/^https?:\/\/(api\.ocarindia\.com|ocar-api\.clienttesting\.in)/.test(BASE)) {
  console.error('Refusing to run against the live production hostname. Use the test hostname.')
  process.exit(2)
}
const HOST_HEADER = process.env.HOST_HEADER
const API = `${BASE}/api/v1`
const results = []

async function call(method, path, { headers = {}, body, redirect = 'follow', raw = false } = {}) {
  const h = { ...headers }
  if (HOST_HEADER) h.host = HOST_HEADER
  if (body !== undefined) h['content-type'] = 'application/json'
  const t0 = performance.now()
  try {
    const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect,
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    let json
    if (!raw) {
      try { json = JSON.parse(text) } catch { /* not JSON */ }
    }
    return { status: res.status, headers: res.headers, text, json, ms: performance.now() - t0 }
  } catch (e) {
    return { status: 0, headers: new Headers(), text: String(e.cause?.code || e.message), ms: performance.now() - t0 }
  }
}

function check(group, name, ok, detail = '') {
  results.push({ group, name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? '  -- ' + detail : ''}`)
}
const leaks = (r) => /stack|at \w+ \(|node_modules|SELECT |INSERT |pg_|ECONN|error\.message/i.test(r.text)

// ---- 1. platform -------------------------------------------------------------------------------------------------
{
  const r = await call('GET', '/health')
  check('platform', 'GET /health is 200 and db/redis ok', r.status === 200 && r.json?.db === 'ok' && r.json?.redis === 'ok', `status ${r.status} ${r.text.slice(0, 80)}`)
  const times = []
  for (let i = 0; i < 10; i++) times.push((await call('GET', '/health')).ms)
  times.sort((a, b) => a - b)
  check('platform', '/health p50 under 400 ms (10 calls, includes your network)', times[4] < 400, `p50 ${times[4].toFixed(0)} ms, max ${times[9].toFixed(0)} ms`)
  if (BASE.startsWith('https://')) {
    const plain = await call('GET', BASE.replace('https://', 'http://') + '/health', { redirect: 'manual' })
    check('platform', 'HTTP redirects to HTTPS', [301, 302, 307, 308].includes(plain.status) && (plain.headers.get('location') || '').startsWith('https://'), `status ${plain.status}`)
  }
  // The API serves Socket.io over websocket only (transports: ['websocket']), so a polling request is correctly refused.
  if (typeof WebSocket === 'undefined' || HOST_HEADER) {
    console.log('skip  [platform] websocket handshake (needs Node 22+ and a real hostname, not a Host-header override)')
  } else {
    const opened = await new Promise((resolve) => {
      const ws = new WebSocket(BASE.replace('https://', 'wss://') + '/socket.io/?EIO=4&transport=websocket')
      const timer = setTimeout(() => { try { ws.close() } catch { /* already closed */ } resolve('timeout') }, 8000)
      ws.onmessage = (m) => { clearTimeout(timer); ws.close(); resolve(String(m.data)) }
      ws.onerror = () => { clearTimeout(timer); resolve('error') }
    })
    check('platform', 'Socket.io websocket handshake opens (Engine.IO open packet)', /^0\{.*"sid"/.test(opened), opened.slice(0, 60))
  }
}

// ---- 2. public reads --------------------------------------------------------------------------------------------
{
  for (const [p, label] of [['/vehicles/categories', 'vehicle categories'], ['/vehicles/brands', 'vehicle brands'], ['/geo/cities', 'active cities'], ['/pricing/rate-cards', 'rate cards']]) {
    const r = await call('GET', `${API}${p}`)
    const data = r.json?.data ?? r.json
    check('public', `GET ${p} returns data (${label})`, r.status === 200 && (Array.isArray(data) ? data.length > 0 : !!data), `status ${r.status}`)
  }
}

// ---- 3. auth is enforced and fails cleanly (401/400, never 500, no leaked internals) ---------------------------------
{
  for (const p of ['/auth/me', '/users/me', '/rides/me/history', '/rides/me/active', '/payments/wallet/user', '/payments/wallet/driver', '/safety/tags', '/notifications/unread-count', '/admin/rides']) {
    const none = await call('GET', `${API}${p}`)
    const bad = await call('GET', `${API}${p}`, { headers: { authorization: 'Bearer not.a.jwt' } })
    check('auth', `GET ${p} without a token is 401 and clean`, none.status === 401 && !leaks(none), `status ${none.status}`)
    check('auth', `GET ${p} with a garbage token is 401 and clean`, bad.status === 401 && !leaks(bad), `status ${bad.status}`)
  }
  const emptyOtp = await call('POST', `${API}/auth/otp/request`, { body: {} })
  check('auth', 'POST /auth/otp/request with an empty body is rejected by validation (no SMS sent)', [400, 422].includes(emptyOtp.status) && !leaks(emptyOtp), `status ${emptyOtp.status}`)
  const badVerify = await call('POST', `${API}/auth/otp/verify`, { body: {} })
  check('auth', 'POST /auth/otp/verify with an empty body is rejected', [400, 422].includes(badVerify.status) && !leaks(badVerify), `status ${badVerify.status}`)
  const adminBad = await call('POST', `${API}/auth/admin/login`, { body: { email: 'nobody@example.invalid', password: 'wrong-password-123' } })
  check('auth', 'POST /auth/admin/login with wrong credentials is 401 (or 429 once rate-limited) and clean', [401, 429].includes(adminBad.status) && !leaks(adminBad), `status ${adminBad.status}`)
  const refreshBad = await call('POST', `${API}/auth/refresh`, { body: { refreshToken: 'x'.repeat(40) } })
  check('auth', 'POST /auth/refresh with an unknown token is 4xx and clean', refreshBad.status >= 400 && refreshBad.status < 500 && !leaks(refreshBad), `status ${refreshBad.status}`)
}

// ---- 4. webhooks reject unsigned or forged calls ------------------------------------------------------------------
{
  const payu = await call('POST', `${API}/payments/webhook/payu`, { body: { txnid: 'R0x0', status: 'success', amount: '1.00', hash: 'forged' } })
  check('webhooks', 'PayU webhook with a forged hash is rejected (not 2xx-confirmed, not 5xx)', payu.status >= 400 && payu.status < 500 || payu.status === 200 && !/confirm|settled/i.test(payu.text), `status ${payu.status}`)
  const ret = await call('POST', `${API}/payments/payu/return`, { body: { txnid: 'R0x0', status: 'success', hash: 'forged' }, redirect: 'manual' })
  check('webhooks', 'PayU return with a forged hash does not 5xx', ret.status < 500, `status ${ret.status}`)
  const sdk = await call('POST', `${API}/payments/payu/sdk-hash`, { body: { hashName: 'payment' } })
  check('webhooks', 'PayU SDK hash signer requires auth (401)', sdk.status === 401, `status ${sdk.status}`)
  const exoPost = await call('POST', `${API}/webhooks/exotel/status`, { body: { CallSid: 'x', Status: 'completed' } })
  const exoGet = await call('GET', `${API}/webhooks/exotel/status?CallSid=x&Status=completed`)
  check('webhooks', 'Exotel status webhook is not accepted (4xx: 404 now that call masking uses BulkSMSPlans; never 2xx or 5xx)', [exoPost, exoGet].every((r) => r.status >= 400 && r.status < 500), `POST ${exoPost.status}, GET ${exoGet.status}`)
}

// ---- 5. errors, headers, CORS ---------------------------------------------------------------------------------------
{
  const nf = await call('GET', `${API}/definitely-not-a-route`)
  check('hardening', 'Unknown route is a clean 404', nf.status === 404 && !leaks(nf), `status ${nf.status}`)
  const bigBody = await call('POST', `${API}/auth/otp/request`, { body: { phone: 'x'.repeat(200000) } })
  check('hardening', 'Oversized body is refused (413/400), not 5xx', [400, 413].includes(bigBody.status), `status ${bigBody.status}`)
  const h = (await call('GET', '/health')).headers
  check('hardening', 'Responses do not advertise the framework (no X-Powered-By)', !h.get('x-powered-by'), `x-powered-by: ${h.get('x-powered-by') || 'absent'}`)
  const good = await call('OPTIONS', `${API}/auth/otp/request`, { headers: { origin: 'https://admin.ocarindia.com', 'access-control-request-method': 'POST' } })
  check('hardening', 'CORS allows the real admin origin', good.headers.get('access-control-allow-origin') === 'https://admin.ocarindia.com', `allow-origin: ${good.headers.get('access-control-allow-origin') || 'absent'}`)
  const evil = await call('OPTIONS', `${API}/auth/otp/request`, { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
  check('hardening', 'CORS does not allow a foreign origin', !evil.headers.get('access-control-allow-origin') || evil.headers.get('access-control-allow-origin') === 'null' ? true : evil.headers.get('access-control-allow-origin') !== 'https://evil.example' && evil.headers.get('access-control-allow-origin') !== '*', `allow-origin: ${evil.headers.get('access-control-allow-origin') || 'absent'}`)
  const metrics = await call('GET', '/metrics')
  check('hardening', '/metrics is not publicly readable', metrics.status !== 200 || !/^# HELP/m.test(metrics.text), `status ${metrics.status}`)
}

// ---- 6. optional: authenticated identity per role ---------------------------------------------------------------------
for (const [role, env] of [['rider', 'RIDER_TOKEN'], ['driver', 'DRIVER_TOKEN'], ['admin', 'ADMIN_TOKEN']]) {
  const token = process.env[env]
  if (!token) { console.log(`skip  [${role}] ${env} not set`); continue }
  const auth = { authorization: `Bearer ${token}` }
  const me = await call('GET', `${API}/auth/me`, { headers: auth })
  const claimed = me.json?.data?.role ?? me.json?.role ?? me.json?.data?.user?.role
  check(role, `GET /auth/me works with a ${role} token`, me.status === 200, `status ${me.status}${claimed ? ', role ' + claimed : ''}`)
  if (role === 'rider') {
    const u = await call('GET', `${API}/users/me`, { headers: auth })
    check(role, 'GET /users/me returns the profile', u.status === 200, `status ${u.status}`)
  }
  if (role !== 'admin') {
    const n = await call('GET', `${API}/notifications/unread-count`, { headers: auth })
    check(role, 'GET /notifications/unread-count works', n.status === 200, `status ${n.status}`)
  }
  const cross = await call('GET', `${API}/admin/rides`, { headers: auth })
  if (role !== 'admin') check(role, `a ${role} token is refused on admin routes (401/403)`, [401, 403].includes(cross.status), `status ${cross.status}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${BASE}`)
if (failed.length) {
  console.log('Failed:')
  for (const f of failed) console.log(`  [${f.group}] ${f.name}  ${f.detail}`)
}
process.exit(failed.length ? 1 : 0)
