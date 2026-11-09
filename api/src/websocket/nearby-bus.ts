import type { Server } from 'socket.io'
import { client as redis } from '@/db/redis'
import { logger } from '@/lib/logger'
import { NEARBY_ROOM_PREFIX, roomOfPoint } from './nearby-cells'

// Live positions of available drivers, fanned out to searching riders (see nearby-cells.ts).
//
// Why not io.to(room).emit like every other event: the socket.io Redis STREAMS adapter writes EVERY broadcast to one shared
// stream (capped at 10,000 entries, replayed to reconnecting clients for connection-state recovery). A position per
// available driver every ~3 s would fill that stream in about a minute and push real ride events out of the recovery window.
// So positions travel on plain Redis pub/sub, one channel per map cell, and each server hands them to its own sockets with
// `io.local` (which skips the adapter and its stream). A server subscribes to a cell's channel only while at least one of its
// sockets is in that cell's room, so publishing for a cell nobody watches costs one cheap PUBLISH and nothing else.
//
// Best effort by design: if Redis or this bus is down, the rider's app still shows the cars from the REST feed it polls.

const log = logger.child({ module: 'nearby-bus' })

export type NearbyCarPayload = {
  /** Opaque, stable-per-driver reference (never the real driver id): the app keys one marker on it. */
  id: string
  lat: number
  lng: number
  /** Compass heading in degrees from the driver's phone, when it reported one. */
  heading?: number
  categoryId: number
}

/** Publish one available driver's position to the cell it is in. Fire and forget; never throws. Returns false when it was
 *  skipped (Redis not ready), so the caller does not count a publish that never happened. */
export function publishNearbyCar(p: NearbyCarPayload): boolean {
  // A disconnected client would queue every publish in memory until it came back: skip instead, the next ping replaces it.
  if (redis.status !== 'ready') return false
  redis.publish(roomOfPoint(p.lat, p.lng), JSON.stringify(p)).catch((err: unknown) => {
    log.warn({ err }, 'nearby publish failed')
  })
  return true
}

const SUBSCRIBE_RETRY_MS = 2_000
const SUBSCRIBE_MAX_ATTEMPTS = 5

/** Start forwarding cell channels to this server's sockets. Never throws: live nearby cars are optional. */
export function initNearbyBus(io: Server): void {
  try {
    const sub = redis.duplicate()
    sub.on('error', (err: unknown) => log.warn({ err }, 'nearby subscriber error'))
    sub.on('message', (room: string, raw: string) => {
      if (!room.startsWith(NEARBY_ROOM_PREFIX)) return
      try {
        io.local.to(room).emit('nearby:car', JSON.parse(raw))
      } catch (err) {
        log.warn({ err }, 'nearby message dropped')
      }
    })
    // The adapter emits these as the first socket joins / the last leaves a room on this server: subscribe and unsubscribe
    // the matching Redis channel then, so an idle cell costs nothing.
    // The cells some local socket is in. The adapter announces a room once, so a subscribe that fails would leave the cell silent
    // for everyone until the room emptied: retry it while the room is still wanted, and re-subscribe everything whenever the
    // subscriber (re)connects, so the Redis channels always match the rooms.
    const wanted = new Set<string>()
    const subscribe = (room: string, attempt = 1): void => {
      sub.subscribe(room).catch((err: unknown) => {
        log.warn({ err, room, attempt }, 'nearby subscribe failed')
        if (attempt < SUBSCRIBE_MAX_ATTEMPTS) {
          setTimeout(() => { if (wanted.has(room)) subscribe(room, attempt + 1) }, SUBSCRIBE_RETRY_MS * attempt)
        }
      })
    }
    sub.on('ready', () => { for (const room of wanted) subscribe(room) })
    const adapter = io.of('/').adapter
    adapter.on('create-room', (room: string) => {
      if (!room.startsWith(NEARBY_ROOM_PREFIX)) return
      wanted.add(room)
      subscribe(room)
    })
    adapter.on('delete-room', (room: string) => {
      if (!room.startsWith(NEARBY_ROOM_PREFIX)) return
      wanted.delete(room)
      sub.unsubscribe(room).catch((err: unknown) => log.warn({ err, room }, 'nearby unsubscribe failed'))
    })
  } catch (err) {
    log.error({ err }, 'nearby bus not started: live nearby cars are off, the app falls back to polling')
  }
}
