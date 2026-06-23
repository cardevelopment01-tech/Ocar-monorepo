import { Server } from 'socket.io'
import type { Server as HttpServer } from 'http'
import { verifyAccessToken } from '@/lib/jwt'
import { config } from '@/config'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { rideAckKey } from '@/constants/redis-keys'
import { getPendingAssignmentsForDriver } from '@/modules/rides/rides.repository'

// Room naming conventions:
//   ride:{rideId}   — user + driver tracking a ride
//   driver:{id}     — private channel for one driver
//   admin:ops       — admin live map

let io: Server

// Grace period before marking a driver offline after socket disconnect.
// Cancels if the driver reconnects within the window — handles page refreshes
// and brief mobile network blips without flipping the driver's DB status.
const OFFLINE_GRACE_MS = 45_000
const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>()

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: config.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as Record<string, string> | undefined)?.token ??
      socket.handshake.headers?.authorization?.replace('Bearer ', '')

    if (!token) {
      return next(new Error('Authentication required'))
    }

    try {
      const decoded = verifyAccessToken(token)
      socket.data.user = decoded
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as { sub: string; role: string } | undefined
    console.log(`Socket connected: ${user?.sub} (${user?.role})`)

    if (user?.role === 'driver') {
      // Cancel any pending offline timer — driver reconnected within grace period
      const pending = pendingOffline.get(user.sub)
      if (pending) {
        clearTimeout(pending)
        pendingOffline.delete(user.sub)
        console.log(`Driver ${user.sub} reconnected — offline grace period cancelled`)
      }
      void socket.join(`driver:${user.sub}`)

      // Clear ACK key when driver confirms receipt of a ride request
      socket.on('ride:request:ack', ({ rideId }: { rideId: string }) => {
        void redis.del(rideAckKey(rideId, user.sub))
      })

      // On reconnect, immediately re-deliver any assignments the driver may have
      // missed while their socket was down (messages are not buffered by Socket.io).
      void getPendingAssignmentsForDriver(BigInt(user.sub))
        .then((assignments) => {
          for (const a of assignments) {
            const expiresMs = new Date(a.expires_at).getTime()
            if (Date.now() >= expiresMs) continue
            const timeoutSeconds = Math.max(1, Math.floor((expiresMs - Date.now()) / 1000))
            const payload: Record<string, unknown> = {
              rideId:           a.ride_id,
              pickup:           a.origin_address    ?? 'Pickup location',
              drop:             a.destination_address ?? 'Destination',
              pickupLat:        a.origin_lat,
              pickupLng:        a.origin_lng,
              distanceToPickup: Math.round(a.distance_to_pickup_metres),
              estimatedFare:    a.total_estimated != null ? parseFloat(a.total_estimated) : 0,
              rideType:         a.ride_type,
              isReturnCab:      a.is_return_cab,
              expiresAt:        a.expires_at,
              timeoutSeconds,
            }
            if (a.dest_lat != null)  payload['destinationLat'] = a.dest_lat
            if (a.dest_lng != null)  payload['destinationLng'] = a.dest_lng
            // Emit directly to this socket so the driver sees remaining time, not original
            socket.emit('ride:request', payload)
          }
        })
        .catch((err: unknown) => {
          console.error(`Reconnect sync failed for driver ${user.sub}:`, err)
        })
    }

    if (user?.role === 'admin') {
      void socket.join('admin:ops')
    }

    socket.on('join:ride', (rideId: string) => {
      void socket.join(`ride:${rideId}`)
    })

    socket.on('leave:ride', (rideId: string) => {
      void socket.leave(`ride:${rideId}`)
    })

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user?.sub} (${user?.role})`)
      if (user?.role === 'driver') {
        const driverSub = user.sub
        // Start grace period instead of marking offline immediately.
        // If the driver reconnects (e.g. page refresh, brief network blip)
        // within OFFLINE_GRACE_MS the timer is cancelled above and the DB
        // session is left untouched.
        const timer = setTimeout(() => {
          pendingOffline.delete(driverSub)
          const driverId = BigInt(driverSub)
          pool.query(
            `UPDATE driver_sessions SET status = 'offline', went_offline_at = now(), offline_reason = 'socket_disconnect'
             WHERE driver_id = $1 AND status IN ('online', 'on_trip')`,
            [driverId]
          ).then(() =>
            pool.query(
              `UPDATE driver_location_snapshots SET is_available = false WHERE driver_id = $1`,
              [driverId]
            )
          ).catch(() => {})
          console.log(`Driver ${driverSub} grace period expired — marked offline`)
        }, OFFLINE_GRACE_MS)
        pendingOffline.set(driverSub, timer)
      }
    })
  })

  return io
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialised')
  return io
}

export const socketEvents = {
  sendRideRequest: (driverId: string, data: object) => {
    getIO().to(`driver:${driverId}`).emit('ride:request', data)
  },

  sendRequestExpired: (driverId: string, rideId: string) => {
    getIO().to(`driver:${driverId}`).emit('ride:request_expired', { rideId })
  },

  sendRideStatusUpdate: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('ride:status_update', data)
  },

  sendDriverLocation: (rideId: string, data: { lat: number; lng: number; heading: number; speed_kmph: number }) => {
    getIO().to(`ride:${rideId}`).emit('driver:location', data)
  },

  sendDriverAssigned: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('ride:driver_assigned', data)
  },

  sendAdminDriverUpdate: (data: object) => {
    getIO().to('admin:ops').emit('driver:location_update', data)
  },
}
