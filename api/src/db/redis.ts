import Redis from 'ioredis'
import { config } from '@/config'

export const client = new Redis(config.REDIS_URL, {
  // In test/dev, don't retry forever — fail fast so health check returns quickly
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  lazyConnect: false,
  retryStrategy: config.NODE_ENV === 'test'
    ? () => null  // stop retrying immediately in test mode
    : (times) => Math.min(times * 50, 2000),
})

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
