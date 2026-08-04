import { Server } from 'socket.io'
import type { Server as HttpServer } from 'http'
import { createAdapter } from '@socket.io/redis-adapter'
import { verifyAccessToken } from '@/lib/jwt'
import { config } from '@/config'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { rideAckKey } from '@/constants/redis-keys'
import { getPendingAssignmentsForDriver } from '@/modules/rides/rides.repository'
import { updateLocation } from '@/modules/rides/rides.service'

// Room naming conventions:
//   ride:{rideId}   user + driver tracking a ride
//   driver:{id}     private channel for one driver
//   admin:ops       admin live map

let io: Server

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: config.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    // Buffers packets emitted to a room during a short disconnect (phone
    // backgrounded, OS suspends idle WebSocket, tab freeze) and replays them
    // + restores room membership automatically on reconnect within the window.
    // Built-in Socket.io v4 feature — no custom replay logic needed.
    // https://socket.io/docs/v4/connection-state-recovery
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  })

  // Without this, io.to(room).emit(...) only reaches sockets connected to THIS
  // process — a client connected to a different API instance would silently
  // never receive the event the moment this runs as more than one instance.
  const pubClient = redis.duplicate()
  const subClient = redis.duplicate()
  io.adapter(createAdapter(pubClient, subClient))

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
      void socket.join(`driver:${user.sub}`)

      // On reconnect, re-join the active ride room so cancellation / status
      // updates still reach the driver. Socket.io does not persist room
      // membership across reconnects, so we re-assert it here.
      void pool.query<{ id: string }>(
        `SELECT id::text FROM rides
         WHERE driver_id = $1
           AND status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')
         ORDER BY accepted_at DESC NULLS LAST LIMIT 1`,
        [BigInt(user.sub)]
      ).then((res) => {
        const rideId = res.rows[0]?.id
        if (rideId) void socket.join(`ride:${rideId}`)
      }).catch(() => {})

      // Clear ACK key when driver confirms receipt of a ride request
      socket.on('ride:request:ack', ({ rideId }: { rideId: string }) => {
        void redis.del(rideAckKey(rideId, user.sub))
      })

      // GPS ping over the already-open connection instead of a fresh HTTP
      // request every ~3s — same handler the POST /sessions/location route uses.
      socket.on('location:update', (data: {
        sessionId: string
        lat: number
        lng: number
        heading?: number
        speed?: number
        recordedAt: string
      }) => {
        const input: Parameters<typeof updateLocation>[1] = {
          sessionId:  BigInt(data.sessionId),
          lat:        data.lat,
          lng:        data.lng,
          recordedAt: data.recordedAt,
        }
        if (data.heading !== undefined) input.heading = data.heading
        if (data.speed   !== undefined) input.speed   = data.speed
        updateLocation(BigInt(user.sub), input).catch((err: unknown) => {
          console.error(`location:update failed for driver ${user.sub}:`, err)
        })
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
            if (a.dest_lat != null)   payload['destinationLat'] = a.dest_lat
            if (a.dest_lng != null)   payload['destinationLng'] = a.dest_lng
            if (a.return_at != null)  payload['returnAt']  = a.return_at
            if (a.trip_hours != null) payload['tripHours'] = Number(a.trip_hours)
            payload['stopCount'] = a.stop_count
            // Emit directly to this socket so the driver sees remaining time, not original
            socket.emit('ride:request', payload)
          }
        })
        .catch((err: unknown) => {
          console.error(`Reconnect sync failed for driver ${user.sub}:`, err)
        })
    }

    if (user?.role === 'user') {
      void socket.join(`user:${user.sub}`)
    }

    if (user?.role === 'admin') {
      void socket.join('admin:ops')
    }

    socket.on('join:ride', (rideId: string) => {
      const callerSub = user?.sub
      if (!callerSub || !rideId) return
      // Join immediately so an event fired the instant this arrives isn't missed
      // while the authorization check below is still in flight (Socket.io doesn't
      // buffer per-room events for late joiners); revoke membership if the check fails.
      void socket.join(`ride:${rideId}`)
      void pool.query<{ user_id: string; driver_id: string | null }>(
        `SELECT user_id::text, driver_id::text FROM rides WHERE id = $1`,
        [BigInt(rideId)]
      ).then((result) => {
        const ride = result.rows[0]
        const isParticipant = !!ride && (
          ride.user_id === callerSub ||
          ride.driver_id === callerSub ||
          user?.role === 'admin'
        )
        if (!isParticipant) void socket.leave(`ride:${rideId}`)
      }).catch(() => { void socket.leave(`ride:${rideId}`) })
    })

    socket.on('leave:ride', (rideId: string) => {
      void socket.leave(`ride:${rideId}`)
    })

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user?.sub} (${user?.role})`)
    })
  })

  return io
}

// Real-time emits are best-effort side effects of whatever DB action triggered them
// (see goOnline in rides.service.ts, which persists the session/location rows before
// emitting) — they must never be able to fail the primary action. `initSocketServer`
// always runs before `httpServer.listen()` in server.ts, so `io` is unset only in
// contexts that never call listen() at all, i.e. integration tests driving `createApp()`
// directly through supertest. Throwing here turned that test gap into 500s with rows
// left committed behind a "failed" response — return a no-op stub instead.
const NOOP_IO = { to: () => ({ emit: () => {} }) } as unknown as Server

export function getIO(): Server {
  if (!io) {
    console.warn('Socket.io not initialised — dropping real-time emit')
    return NOOP_IO
  }
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

  // Rider-only channel — for payloads (e.g. ride OTPs) that must never reach
  // the driver's socket, even though driver and rider share the ride:{id} room.
  sendUserUpdate: (userId: string, data: object) => {
    getIO().to(`user:${userId}`).emit('ride:status_update', data)
  },

  sendDriverLocation: (rideId: string, data: { lat: number; lng: number; heading: number; speed_kmph: number }) => {
    getIO().to(`ride:${rideId}`).emit('driver:location', data)
  },

  // Road-snapped segment of the rental "flexible route" trail — see
  // rides.service.ts updateLocation's TRAIL_SNAP_BATCH_SIZE buffering.
  sendTrailSegment: (rideId: string, points: Array<{ lat: number; lng: number }>) => {
    getIO().to(`ride:${rideId}`).emit('driver:trail_segment', { points })
  },

  sendDriverAssigned: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('ride:driver_assigned', data)
  },

  sendStopUpdated: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('stop:updated', data)
  },

  sendStopAdded: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('stop:added', data)
  },

  sendAdminDriverUpdate: (data: object) => {
    getIO().to('admin:ops').emit('driver:location_update', data)
  },

  sendStuckRideFlagged: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('ride:stuck_flagged', data)
    getIO().to('admin:ops').emit('ride:stuck_flagged', { rideId, ...data })
  },

  // In-app notification feed — delivers a fresh item straight into an open
  // app so the bell/feed updates live, without waiting for a manual refetch.
  sendNotification: (ownerType: 'user' | 'driver' | 'admin', ownerId: string, data: object) => {
    const room = ownerType === 'admin' ? 'admin:ops' : `${ownerType}:${ownerId}`
    getIO().to(room).emit('notification:new', data)
  },
}
