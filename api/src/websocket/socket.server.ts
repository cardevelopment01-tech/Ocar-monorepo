import { Server } from 'socket.io'
import type { Server as HttpServer } from 'http'
import { verifyAccessToken } from '@/lib/jwt'
import { config } from '@/config'
import { pool } from '@/db/client'

// Room naming conventions:
//   ride:{rideId}   — user + driver tracking a ride
//   driver:{id}     — private channel for one driver
//   admin:ops       — admin live map

let io: Server

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
      void socket.join(`driver:${user.sub}`)
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
        const driverId = BigInt(user.sub)
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
