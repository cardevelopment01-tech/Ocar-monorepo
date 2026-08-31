import Redis, { type RedisOptions } from 'ioredis'
import { config } from '@/config'
import { logger } from '@/lib/logger'

function makeRedisOptions(): RedisOptions {
  const url = new URL(config.REDIS_URL)
  const opts: RedisOptions = {
    host: url.hostname,
    port: Number(url.port) || (url.protocol === 'rediss:' ? 6380 : 6379),
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
    retryStrategy: config.NODE_ENV === 'test'
      ? () => null
      : (times) => Math.min(times * 50, 2000),
  }
  if (url.password) opts.password = decodeURIComponent(url.password)
  if (url.protocol === 'rediss:') opts.tls = {}
  return opts
}

export const client = new Redis(makeRedisOptions())

// `client` is shared with BullMQ (see jobs/queues/index.ts), which relies on
// long-blocking commands (BRPOPLPUSH etc.) that are SUPPOSED to wait for a
// long time -- a client-wide commandTimeout would kill those and crash the
// process. Bound only the ad-hoc cache commands this module issues instead.
const CACHE_COMMAND_TIMEOUT_MS = 200

export function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis command timeout')), CACHE_COMMAND_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

client.on('error', (err) => {
  logger.error({ err }, 'redis error')
})

client.on('connect', () => {
  logger.info('redis connected')
})

export async function setWithTTL(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  await withTimeout(client.set(key, value, 'EX', ttlSeconds))
}

export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const value = await withTimeout(client.get(key))
    if (value === null) return null
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
      ),
    ])
    return result === 'PONG'
  } catch {
    return false
  }
}
