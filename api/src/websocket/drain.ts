import type { Server, Socket } from 'socket.io'
import { logger } from '@/lib/logger'

// Graceful socket drain.
//
// Why: when a server is removed (deploy scale-down, autoscaler scale-in) the load balancer keeps its WebSockets
// open until the deregistration delay (300 s) ends and then closes every one of them in the same instant, so all
// of that server's users reconnect together (measured 2026-10: ~720 new connections in one minute against a
// normal 20-30). Draining closes them gradually, in random order, over `durationMs` BEFORE that cut-off, so the
// reconnects arrive as a trickle and every client reconnects by itself.
//
// How a socket is closed matters, verified against socket.io 4.8.3:
//   socket.conn.close()      -> client reason "transport close": it reconnects on its own (~1 s) and its session
//                               is recovered (connectionStateRecovery).
//   socket.disconnect(true)  -> client reason "io server disconnect": it does NOT reconnect. Never use it here.
// For the same reason a draining server must not refuse connections from a middleware: a client refused by a
// middleware does not retry on its own. A late arrival is accepted and closed like the rest.

let current: Drain | null = null

export interface Drain {
  total: number
  /** Resolves when every socket that was connected when the drain started has been closed. */
  done: Promise<void>
}

export function isDraining(): boolean {
  return current !== null
}

/** For tests only. */
export function resetDrainForTests(): void {
  current = null
}

function closeTransport(socket: Socket): void {
  try {
    socket.conn.close()
  } catch (err) {
    logger.warn({ err }, 'socket drain: closing a socket failed')
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Starts closing every connected socket, spread randomly over `durationMs`. Idempotent: a second call returns the
 * drain already in progress. Keep `durationMs` well under the load balancer's deregistration delay (300 s).
 */
export function startDrain(io: Server, durationMs: number, reason: string): Drain {
  if (current) return current

  const sockets = shuffle([...io.of('/').sockets.values()])
  const total = sockets.length
  const step = total > 0 ? durationMs / total : 0
  logger.info({ total, durationMs, reason }, 'socket drain started')

  let closed = 0
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const finish = (): void => {
    logger.info({ total, closed, durationMs, reason }, 'socket drain finished')
    resolveDone()
  }

  // Socket i is closed at a random moment inside its own slot [i*step, (i+1)*step), so at most about one close
  // per slot and never more than ~2x the average rate in any second.
  sockets.forEach((socket, i) => {
    const delay = Math.min(durationMs, Math.round(i * step + Math.random() * step))
    const timer = setTimeout(() => {
      closeTransport(socket)
      closed++
      if (closed === total) finish()
    }, delay)
    timer.unref()
  })
  if (total === 0) finish()

  // A client that reconnects here while we drain (recovery skips middlewares, so it can slip in) is closed
  // shortly after, at the transport, so it moves on again like everyone else.
  io.on('connection', (socket) => {
    const timer = setTimeout(() => closeTransport(socket), Math.round(Math.random() * Math.min(5000, durationMs / 2)))
    timer.unref()
  })

  current = { total, done }
  return current
}
