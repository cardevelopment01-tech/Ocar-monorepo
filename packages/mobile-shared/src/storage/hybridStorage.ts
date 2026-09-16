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
 * SecureStore is written first. If the AsyncStorage write then fails, the
 * SecureStore write is rolled back to its previous value before rethrowing --
 * without this, a token rotation could commit with no matching profile update,
 * the exact half-written state this store (which holds auth tokens) can't
 * tolerate. Not true two-phase commit (a crash mid-rollback isn't covered),
 * but closes the realistic single-write-failure case.
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
      const previousSecureRaw = await secure.getItem(secureKey(key))
      await secure.setItem(secureKey(key), JSON.stringify(secureState))
      try {
        await asyncStorage.setItem(key, JSON.stringify({ ...envelope, state: restState }))
      } catch (err) {
        if (previousSecureRaw !== null) await secure.setItem(secureKey(key), previousSecureRaw)
        else await secure.removeItem(secureKey(key))
        throw err
      }
    },

    async removeItem(key) {
      await Promise.all([secure.removeItem(secureKey(key)), asyncStorage.removeItem(key)])
    },
  }
}
