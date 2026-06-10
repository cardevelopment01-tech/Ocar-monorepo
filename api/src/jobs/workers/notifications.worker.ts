import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import { config } from '@/config'
import { sendSms } from '@/providers/sms.provider'
import * as notifService from '@/modules/notifications/notifications.service'

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
    }
    // Unknown job names (e.g. broadcast_ride) complete silently
  },
  {
    connection:  redisConnection,
    concurrency: 5,
    limiter:     { max: 10, duration: 1000 },
  }
)
