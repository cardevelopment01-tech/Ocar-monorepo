// Test-only (never committed): keeps the seeded drivers "driving" by sending real location pings every 3 s (like the
// driver app), so the rider's nearby-cars layer and the assigned car have something to follow.
import fs from 'fs'

type D = { phone: string; accessToken: string; sessionId: string; lat: number; lng: number; bearing: number }
const state: D[] = JSON.parse(fs.readFileSync('scripts/maptest-state.json', 'utf8'))
const PICKUP = { lat: 20.2961, lng: 85.8245 }
const DEG_PER_M = 1 / 111_320
const STEP_M = 28 // ~34 km/h at one ping per 3 s
const only = process.argv[2] // optional phone: move just that driver

async function ping(d: D) {
  const res = await fetch('http://localhost:4000/api/v1/rides/sessions/location', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + d.accessToken },
    body: JSON.stringify({ sessionId: d.sessionId, lat: d.lat, lng: d.lng, heading: d.bearing, speed: STEP_M / 3, recordedAt: new Date().toISOString() }),
  })
  if (res.status >= 300) console.log(d.phone, 'ping', res.status, (await res.text()).slice(0, 120))
}

function advance(d: D) {
  const rad = (d.bearing * Math.PI) / 180
  d.lat += STEP_M * Math.cos(rad) * DEG_PER_M
  d.lng += (STEP_M * Math.sin(rad) * DEG_PER_M) / Math.cos((d.lat * Math.PI) / 180)
  // Turn gently, and turn back toward the pickup when drifting beyond ~2.8 km so the cars stay around it.
  const dLat = (d.lat - PICKUP.lat) / DEG_PER_M
  const dLng = ((d.lng - PICKUP.lng) / DEG_PER_M) * Math.cos((d.lat * Math.PI) / 180)
  if (Math.hypot(dLat, dLng) > 2800) d.bearing = ((Math.atan2(-dLng, -dLat) * 180) / Math.PI + 360) % 360
  else d.bearing = (d.bearing + (Math.random() * 14 - 7) + 360) % 360
}

async function tick() {
  for (const d of state) {
    if (only && d.phone !== only) { /* others keep moving too */ }
    advance(d)
    await ping(d)
  }
}
console.log('moving', state.length, 'drivers every 3 s (Ctrl+C / kill to stop)')
void tick()
setInterval(() => void tick(), 3000)
