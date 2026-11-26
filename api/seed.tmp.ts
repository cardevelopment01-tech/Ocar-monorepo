import { pool } from '@/db/client'
import * as repo from '@/modules/rides/rides.repository'
;(async () => {
  const mins = Number(process.argv[2] ?? 75); const label = process.argv[3] ?? 'A'
  const u = await pool.query("INSERT INTO users (phone, name) VALUES ('+919999111222', 'Anita Rider') ON CONFLICT (phone) DO UPDATE SET name = 'Anita Rider' RETURNING id")
  const r = await repo.createRide({ userId: BigInt(u.rows[0].id), categoryId: 2n, rideType: 'one_way', isReturnCab: false, originLat: 20.2961, originLng: 85.8245,
    originAddress: `Biju Patnaik Airport, Bhubaneswar (${label})`, destinationLat: 20.4625, destinationLng: 85.883, destinationAddress: 'Cuttack Bus Stand', originCityId: 1n,
    scheduledFor: new Date(Date.now() + mins * 60_000).toISOString(), status: 'scheduled' })
  const id = BigInt((r as { id: string }).id)
  const c = await pool.connect()
  await repo.insertFareSnapshot(c, { rideId: String(id), rateCardId: null, rentalPackageId: null, rideType: 'one_way', isReturnCab: false, surgeEventId: null, surgeMultiplier: 1,
    estimatedKm: 28, estimatedMin: 40, stopCount: 0, tripHours: 0, baseFare: 0, distanceFare: 640, timeFare: 0, stopFare: 0, hourSurcharge: 0, surgeFare: 0, total: 640, pricingVersion: 1, waitingFare: 0, discountAmount: 0 } as never)
  c.release()
  await repo.createAdvanceMeta({ rideId: id, dispatchBufferMinutes: 15 })
  console.log('ride', String(id), 'pickup in', mins, 'min'); process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
