import Redis, { type RedisOptions } from 'ioredis'
import { config } from '@/config'

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

client.on('error', (err) => {
  console.error('Redis error:', err)
})

client.on('connect', () => {
  console.log('Redis connected')
})

export async function setWithTTL(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  await client.set(key, value, 'EX', ttlSeconds)
}

export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const value = await client.get(key)
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
