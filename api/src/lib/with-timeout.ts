// Bounds an ad-hoc Redis command. Lives outside db/redis.ts so modules can use it without importing the client
// (and so test files that mock '@/db/redis' keep working).
//
// 1000ms, not tighter: a FRESH connection to the TLS ElastiCache pays a handshake before its first command, which
// routinely exceeded 200ms on cold-booted instances (see the history note in db/redis.ts).
const CACHE_COMMAND_TIMEOUT_MS = 1000

export function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis command timeout')), CACHE_COMMAND_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
