import { Worker } from 'bullmq'
import { workerPool as pool } from '@/db/client'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger(undefined, 'gps-flush')

interface GpsTrackJob {
  rideId: string
  driverId: string
  sessionId: string
  lat: number
  lng: number
  heading?: number
  speed?: number
  recordedAt: string
}

export const gpsFlushWorker = new Worker<GpsTrackJob>(
  QUEUE_NAMES.GPS_FLUSH,
  async (job) => {
    const { rideId, driverId, sessionId, lat, lng, heading, speed, recordedAt } = job.data
    await pool.query(
      `INSERT INTO gps_tracks
         (ride_id, driver_id, session_id, location, heading, speed_kmph, recorded_at)
       VALUES ($1, $2, $3,
         ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography,
         $6, $7, $8
       )
       ON CONFLICT DO NOTHING`,
      [
        BigInt(rideId),
        BigInt(driverId),
        BigInt(sessionId),
        lat,
        lng,
        heading ?? null,
        speed   ?? null,
        recordedAt,
      ]
    )
  },
  {
    connection:  redisConnection,
    concurrency: 20,
    limiter:     { max: 500, duration: 1000 },
  }
)

gpsFlushWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'gps-flush job failed')
})
