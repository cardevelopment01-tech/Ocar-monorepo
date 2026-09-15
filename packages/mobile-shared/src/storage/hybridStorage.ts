import type { StorageBackend } from './secureStorage'

interface PersistedEnvelope {
  state: Record<string, unknown>
  version?: number
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) if (key in obj) out[key] = obj[key]
  return out
}

function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) if (!keys.includes(key)) out[key] = obj[key]
  return out
}

const secureKey = (key: string): string => `${key}:secure`

/**
 * Splits a zustand persist write across two backends: `secureFields` go to
 * `secure`, everything else to `async`. SecureStore's 2048-byte ceiling means
 * only small, sensitive fields (tokens) belong there -- see secureStorage.ts.
 *
 * SecureStore is written first; the async write only runs if it succeeds, and
 * either failure rejects the whole call so zustand's persist middleware
 * surfaces the error rather than landing a half-written state. A later write
 * retries and self-heals.
 */
export function createHybridStorage(
  secure: StorageBackend,
  asyncStorage: StorageBackend,
  secureFields: string[]
): StorageBackend {
  return {
    async getItem(key) {
      const [secureRaw, asyncRaw] = await Promise.all([
        secure.getItem(secureKey(key)),
        asyncStorage.getItem(key),
      ])
      if (!asyncRaw) return null
      const envelope = JSON.parse(asyncRaw) as PersistedEnvelope
      const secureState = secureRaw ? (JSON.parse(secureRaw) as Record<string, unknown>) : {}
      return JSON.stringify({ ...envelope, state: { ...envelope.state, ...secureState } })
    },

    async setItem(key, value) {
      const envelope = JSON.parse(value) as PersistedEnvelope
      const secureState = pick(envelope.state, secureFields)
      const restState = omit(envelope.state, secureFields)
      await secure.setItem(secureKey(key), JSON.stringify(secureState))
      await asyncStorage.setItem(key, JSON.stringify({ ...envelope, state: restState }))
    },

    async removeItem(key) {
      await Promise.all([secure.removeItem(secureKey(key)), asyncStorage.removeItem(key)])
    },
  }
}
