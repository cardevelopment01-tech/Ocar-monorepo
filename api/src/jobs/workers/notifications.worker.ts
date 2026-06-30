import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import { config } from '@/config'
import { sendSms } from '@/providers/sms.provider'
import * as notifService from '@/modules/notifications/notifications.service'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import { processAckCheck, type AckCheckJobData } from '@/jobs/processors/ack-check.processor'
import { pool } from '@/db/client'

type LogParams = Parameters<typeof notifService.logNotification>[0]

export const notificationsWorker = new Worker(
  QUEUE_NAMES.NOTIFICATIONS,
  async (job) => {
    if (job.name === 'driver_submitted_for_review') {
      const data = job.data as {
        driverId: string
        driverName: string
        driverPhone: string
        submittedAt: string
      }
      const lp: LogParams = { jobName: job.name, templateKey: 'driver_review', payload: data as Record<string, unknown> }
      if (config.ADMIN_PHONE) lp.recipientPhone = config.ADMIN_PHONE
      const logId = await notifService.logNotification(lp)
      try {
        const message = `Ocar: New driver application received. Driver: ${data.driverName} (${data.driverPhone}). Submitted at ${data.submittedAt}. Log in to admin panel to review.`
        if (config.ADMIN_PHONE) await sendSms(config.ADMIN_PHONE, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

    } else if (job.name === 'otp_sms') {
      const data = job.data as {
        phone: string
        otp: string
        type: 'auth' | 'trip_start' | 'trip_end'
      }
      const lp: LogParams = { jobName: job.name, templateKey: 'otp_sms', payload: data as Record<string, unknown> }
      if (data.phone) lp.recipientPhone = data.phone
      const logId = await notifService.logNotification(lp)
      try {
        const messages: Record<string, string> = {
          auth:       `Your Ocar login OTP is ${data.otp}. Valid for 10 minutes. Do not share with anyone.`,
          trip_start: `Your Ocar trip OTP is ${data.otp}. Share this with your driver to start the ride.`,
          trip_end:   `Your Ocar trip OTP is ${data.otp}. Share this with your driver to complete the ride.`,
        }
        const message = messages[data.type] ?? messages['auth']!
        await sendSms(data.phone, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

    } else if (job.name === 'sos_alert') {
      const data = job.data as {
        rideId:      string
        userId:      string
        userPhone:   string
        lat:         number
        lng:         number
        triggeredAt: string
      }
      const lp: LogParams = { jobName: job.name, templateKey: 'sos_alert', payload: data as Record<string, unknown> }
      if (config.ADMIN_PHONE) lp.recipientPhone = config.ADMIN_PHONE
      const logId = await notifService.logNotification(lp)
      try {
        const message = `OCAR SOS ALERT: Passenger ${data.userPhone} triggered an SOS during ride #${data.rideId}. Location: ${data.lat},${data.lng}. Time: ${data.triggeredAt}. Take immediate action.`
        if (config.ADMIN_PHONE) await sendSms(config.ADMIN_PHONE, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }
    } else if (job.name === 'ride_accepted') {
      const data = job.data as {
        rideId:      string
        userPhone:   string
        driverName:  string | null
        driverPhone: string | null
      }
      const lp: LogParams = { jobName: job.name, templateKey: 'ride_accepted', recipientPhone: data.userPhone, payload: data as Record<string, unknown> }
      const logId = await notifService.logNotification(lp)
      try {
        const name  = data.driverName  ?? 'Your driver'
        const phone = data.driverPhone ? ` (${data.driverPhone})` : ''
        const message = `Ocar: ${name}${phone} has accepted your ride and is on the way to pick you up.`
        await sendSms(data.userPhone, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

    } else if (job.name === 'ride_completed') {
      const data = job.data as {
        rideId:     string
        userPhone:  string
        driverName: string | null
      }
      const lp: LogParams = { jobName: job.name, templateKey: 'ride_completed', recipientPhone: data.userPhone, payload: data as Record<string, unknown> }
      const logId = await notifService.logNotification(lp)
      try {
        const fareRes = await pool.query<{ amount: string }>(
          `SELECT COALESCE(total_final, total_estimated)::numeric AS amount
           FROM fare_snapshots WHERE ride_id = $1`,
          [BigInt(data.rideId)]
        )
        const fare    = fareRes.rows[0] ? Math.round(parseFloat(fareRes.rows[0].amount)) : null
        const fareStr = fare != null && fare > 0 ? ` Total fare: ₹${fare}.` : ''
        const message = `Ocar: Your ride is complete!${fareStr} Thank you for riding with Ocar.`
        await sendSms(data.userPhone, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

    } else if (job.name === 'broadcast_ride') {
      await processBroadcast(job.data as BroadcastJobData)
    } else if (job.name === 'broadcast_ride_ack_check') {
      await processAckCheck(job.data as AckCheckJobData)
    }
    // Unknown job names complete silently
  },
  {
    connection:  redisConnection,
    concurrency: 5,
    limiter:     { max: 10, duration: 1000 },
  }
)

notificationsWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job failed: ${job?.name ?? 'unknown'} id=${job?.id}`, err)
})

notificationsWorker.on('error', (err) => {
  console.error('[Worker] Notifications worker error:', err)
})
