import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import { config } from '@/config'
import { sendSms } from '@/providers/sms.provider'
import { sendEmail } from '@/lib/email'
import * as notifService from '@/modules/notifications/notifications.service'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { workerPool as pool } from '@/db/client'

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
      const lp: LogParams = { jobName: job.name, payload: data as Record<string, unknown> }
      if (config.ADMIN_PHONE) lp.recipientPhone = config.ADMIN_PHONE
      const logId = await notifService.logNotification(lp)
      try {
        const { body: message } = await renderTemplate('driver_submitted_for_review', 'sms', {
          driverName: data.driverName, driverPhone: data.driverPhone, submittedAt: data.submittedAt,
        })
        if (config.ADMIN_PHONE) await sendSms(config.ADMIN_PHONE, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

      try {
        const { subject, body } = await renderTemplate('driver_submitted_for_review', 'push', {
          driverName: data.driverName,
        })
        await notifService.notifyAllAdmins({
          type: 'driver_submitted_for_review',
          title: subject ?? 'New Driver Application',
          body,
          payload: { driverId: data.driverId },
        })
      } catch (err) {
        console.error('[Worker] notify failed for driver_submitted_for_review:', err)
      }

    } else if (job.name === 'otp_sms') {
      const data = job.data as {
        phone: string
        otp: string
        type: 'auth' | 'trip_start' | 'trip_end'
      }
      const lp: LogParams = { jobName: job.name, payload: data as Record<string, unknown> }
      if (data.phone) lp.recipientPhone = data.phone
      const logId = await notifService.logNotification(lp)
      try {
        const slug = data.type === 'trip_start' ? 'otp_trip_start' : data.type === 'trip_end' ? 'otp_trip_end' : 'otp_auth'
        const { body: message } = await renderTemplate(slug, 'sms', { otp: data.otp })
        // DLT template 193042 is approved for login OTP wording only — ride
        // start/end OTPs tell the rider to share the code with their driver,
        // which this template's "do not share" text would contradict.
        const templateId = slug === 'otp_auth' ? (config.BULKSMSPLANS_OTP_TEMPLATE_ID || undefined) : undefined
        await sendSms(data.phone, message, templateId)
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
      const lp: LogParams = { jobName: job.name, payload: data as Record<string, unknown> }
      if (config.ADMIN_PHONE) lp.recipientPhone = config.ADMIN_PHONE
      const logId = await notifService.logNotification(lp)
      try {
        const { body: message } = await renderTemplate('sos_alert', 'sms', {
          userPhone: data.userPhone, rideId: data.rideId,
          lat: String(data.lat), lng: String(data.lng), triggeredAt: data.triggeredAt,
        })
        if (config.ADMIN_PHONE) await sendSms(config.ADMIN_PHONE, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

      try {
        const { subject, body } = await renderTemplate('sos_alert', 'push', { rideId: data.rideId })
        await notifService.notifyAllAdmins({
          type: 'sos',
          title: subject ?? 'SOS ALERT',
          body,
          payload: { lat: data.lat, lng: data.lng },
          rideId: BigInt(data.rideId),
        })
      } catch (err) {
        console.error('[Worker] notify failed for sos_alert:', err)
      }
    } else if (job.name === 'ride_accepted') {
      const data = job.data as {
        rideId:      string
        userId:      string
        userPhone:   string
        driverName:  string | null
        driverPhone: string | null
      }
      const lp: LogParams = { jobName: job.name, recipientPhone: data.userPhone, payload: data as Record<string, unknown> }
      const logId = await notifService.logNotification(lp)
      const driverName = data.driverName ?? 'Your driver'
      try {
        const { body: message } = await renderTemplate('ride_accepted', 'sms', {
          driverName,
        })
        await sendSms(data.userPhone, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

      try {
        const { subject, body } = await renderTemplate('ride_accepted', 'push', { driverName })
        await notifService.notifyOwner({
          ownerType: 'user',
          ownerId: BigInt(data.userId),
          type: 'ride_accepted',
          title: subject ?? 'Driver on the way',
          body,
          rideId: BigInt(data.rideId),
        })
      } catch (err) {
        console.error('[Worker] notify failed for ride_accepted:', err)
      }

    } else if (job.name === 'ride_completed') {
      const data = job.data as {
        rideId:     string
        userId:     string
        userPhone:  string
        driverName: string | null
      }
      const lp: LogParams = { jobName: job.name, recipientPhone: data.userPhone, payload: data as Record<string, unknown> }
      const logId = await notifService.logNotification(lp)
      try {
        const fareRes = await pool.query<{ amount: string }>(
          `SELECT COALESCE(total_final, total_estimated)::numeric AS amount
           FROM fare_snapshots WHERE ride_id = $1`,
          [BigInt(data.rideId)]
        )
        const fare    = fareRes.rows[0] ? Math.round(parseFloat(fareRes.rows[0].amount)) : null
        const fareStr = fare != null && fare > 0 ? ` Total fare: ₹${fare}.` : ''
        const { body: message } = await renderTemplate('ride_completed', 'sms', { fareStr })
        await sendSms(data.userPhone, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

      try {
        const { subject, body } = await renderTemplate('ride_completed', 'push', {})
        await notifService.notifyOwner({
          ownerType: 'user',
          ownerId: BigInt(data.userId),
          type: 'ride_completed',
          title: subject ?? 'Ride Complete',
          body,
          rideId: BigInt(data.rideId),
        })
      } catch (err) {
        console.error('[Worker] notify failed for ride_completed:', err)
      }

    } else if (job.name === 'admin_invite_email') {
      const data = job.data as { email: string; rawToken: string; expiresAt: string }
      const lp: LogParams = { jobName: job.name, payload: { email: data.email } }
      const logId = await notifService.logNotification(lp)
      try {
        const redeemUrl = `${config.ADMIN_APP_URL}/accept-invite?token=${data.rawToken}`
        const { subject, body } = await renderTemplate('admin_invite', 'email', {
          redeemUrl, expiresAt: data.expiresAt,
        })
        await sendEmail(data.email, subject ?? 'You\'ve been invited to Ocar admin', body)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

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
