#!/usr/bin/env node
// Feeds a continuous stream of GPS fixes along a real, road-snapped route into an
// already-open Chrome tab via the DevTools Protocol — so watchPosition-driven UI
// (heading-locked camera, dynamic zoom, maneuver banner, voice guidance) behaves
// like an actual drive instead of the single-teleport look you get from manually
// typing one coordinate at a time into DevTools' Sensors panel.
//
// Setup (one-time per session):
//   1. Launch Chrome with remote debugging enabled, e.g. on Windows:
//        & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug-profile"
//      (a separate --user-data-dir avoids fighting your normal Chrome instance)
//   2. In that Chrome window, open the driver app and navigate to
//      NavigateToPickup or TripInProgress (needs an active ride assigned to your
//      test driver — see the "Missing or invalid environment variables" / testing
//      conversation above for how to set one up).
//   3. Run this script from the repo root or apps/driver:
//        node apps/driver/scripts/simulate-drive.mjs <originLat> <originLng> <destLat> <destLng>
//
// Options (env vars): API_BASE (default http://localhost:4000),
//   TAB_ORIGIN (default http://localhost:5173), INTERVAL_MS (default 700).

const [originLat, originLng, destLat, destLng] = process.argv.slice(2).map(Number)
if ([originLat, originLng, destLat, destLng].some(Number.isNaN)) {
  console.error('Usage: node simulate-drive.mjs <originLat> <originLng> <destLat> <destLng>')
  process.exit(1)
}

const API_BASE = process.env.API_BASE ?? 'http://localhost:4000'
const TAB_ORIGIN = process.env.TAB_ORIGIN ?? 'http://localhost:5173'
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 700)

// Standard Google encoded-polyline decode — same algorithm as apps/driver/src/lib/polyline.ts,
// duplicated here since this script runs standalone outside the app's TS build.
function decodePolyline(encoded) {
  const points = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let result = 0, shift = 0, b
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    result = 0
    shift = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  console.log(`Fetching route ${originLat},${originLng} -> ${destLat},${destLng} from ${API_BASE}...`)
  const routeRes = await fetch(
    `${API_BASE}/api/v1/geo/route?originLat=${originLat}&originLng=${originLng}` +
    `&destLat=${destLat}&destLng=${destLng}&trafficAware=true`
  )
  if (!routeRes.ok) {
    console.error(`Route fetch failed: HTTP ${routeRes.status}. Is the API running at ${API_BASE}?`)
    process.exit(1)
  }
  const route = await routeRes.json()
  if (!route.polyline) {
    console.error(
      'Route came back with no polyline (haversine fallback) — check GOOGLE_MAPS_API_KEY ' +
      'is set in api/.env, since a straight-line fallback has no real road geometry to drive along.'
    )
    process.exit(1)
  }

  const points = decodePolyline(route.polyline)
  console.log(`Decoded ${points.length} points, ${route.distanceKm}km, ~${route.durationMin}min real drive time.`)
  console.log(`Feeding one point every ${INTERVAL_MS}ms — total simulated time: ~${Math.round(points.length * INTERVAL_MS / 1000)}s.`)

  console.log(`Looking for an open tab starting with ${TAB_ORIGIN}...`)
  const targetsRes = await fetch('http://localhost:9222/json')
  if (!targetsRes.ok) {
    console.error(
      'Could not reach Chrome DevTools Protocol on port 9222 — launch Chrome with ' +
      '--remote-debugging-port=9222 first (see the comment at the top of this script).'
    )
    process.exit(1)
  }
  const targets = await targetsRes.json()
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith(TAB_ORIGIN))
  if (!page) {
    console.error(`No open tab found starting with ${TAB_ORIGIN}. Open the driver app in that Chrome window first.`)
    process.exit(1)
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let msgId = 0
  const send = (method, params) => ws.send(JSON.stringify({ id: ++msgId, method, params }))

  console.log('Connected. Driving...')
  for (const [lat, lng] of points) {
    // accuracy=5 (metres) — well inside the app's 80m gate, so every fix is accepted,
    // unlike DevTools' Sensors panel UI which reports a fixed ~150m accuracy.
    send('Emulation.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 5 })
    await sleep(INTERVAL_MS)
  }

  console.log('Reached destination.')
  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
