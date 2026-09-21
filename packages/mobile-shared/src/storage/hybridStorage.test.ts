import { describe, expect, it } from 'vitest'
import type { StorageBackend } from './secureStorage'
import { createHybridStorage } from './hybridStorage'

function makeFakeBackend(): StorageBackend & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    async getItem(key) {
      return data.has(key) ? data.get(key)! : null
    },
    async setItem(key, value) {
      data.set(key, value)
    },
    async removeItem(key) {
      data.delete(key)
    },
  }
}

describe('createHybridStorage', () => {
  it('routes secureFields to the secure backend and the rest to the async backend', async () => {
    const secure = makeFakeBackend()
    const asyncStorage = makeFakeBackend()
    const storage = createHybridStorage(secure, asyncStorage, ['token', 'refreshToken'])

    await storage.setItem(
      'ocar_driver_auth',
      JSON.stringify({ state: { token: 'abc', refreshToken: 'def', driver: { id: '1' }, isAuthenticated: true }, version: 0 })
    )

    expect(secure.data.get('ocar_driver_auth_secure')).toBe(JSON.stringify({ token: 'abc', refreshToken: 'def' }))
    const asyncEnvelope = JSON.parse(asyncStorage.data.get('ocar_driver_auth')!)
    expect(asyncEnvelope.state).toEqual({ driver: { id: '1' }, isAuthenticated: true })
    expect(asyncEnvelope.state.token).toBeUndefined()
  })

  it('merges both backends back into one envelope on read', async () => {
    const secure = makeFakeBackend()
    const asyncStorage = makeFakeBackend()
    const storage = createHybridStorage(secure, asyncStorage, ['token', 'refreshToken'])

    const original = { state: { token: 'abc', refreshToken: 'def', driver: { id: '1' }, isAuthenticated: true }, version: 0 }
    await storage.setItem('ocar_driver_auth', JSON.stringify(original))

    const readBack = JSON.parse((await storage.getItem('ocar_driver_auth'))!)
    expect(readBack).toEqual(original)
  })

  it('returns null when nothing has been written', async () => {
    const storage = createHybridStorage(makeFakeBackend(), makeFakeBackend(), ['token'])
    expect(await storage.getItem('missing')).toBeNull()
  })

  it('rejects the whole write when the secure backend fails, without touching async', async () => {
    const secure: StorageBackend = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('keystore error')
      },
      removeItem: async () => {},
    }
    const asyncStorage = makeFakeBackend()
    const storage = createHybridStorage(secure, asyncStorage, ['token'])

    await expect(storage.setItem('key', JSON.stringify({ state: { token: 'x', other: 1 } }))).rejects.toThrow(
      'keystore error'
    )
    expect(asyncStorage.data.size).toBe(0)
  })

  it('rolls back the secure write when the async write fails, no half-written state', async () => {
    const secure = makeFakeBackend()
    const asyncStorage: StorageBackend = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('async storage full')
      },
      removeItem: async () => {},
    }
    const storage = createHybridStorage(secure, asyncStorage, ['token'])

    // Establish a prior committed value first.
    const workingAsync = makeFakeBackend()
    const workingStorage = createHybridStorage(secure, workingAsync, ['token'])
    await workingStorage.setItem('key', JSON.stringify({ state: { token: 'old-token', other: 1 } }))
    expect(secure.data.get('key_secure')).toBe(JSON.stringify({ token: 'old-token' }))

    await expect(storage.setItem('key', JSON.stringify({ state: { token: 'new-token', other: 2 } }))).rejects.toThrow(
      'async storage full'
    )

    // Rolled back to the pre-write value, not left holding the new (uncommitted-elsewhere) token.
    expect(secure.data.get('key_secure')).toBe(JSON.stringify({ token: 'old-token' }))
  })

  it('removes the secure entry (no rollback target) when the async write fails on a first write', async () => {
    const secure = makeFakeBackend()
    const asyncStorage: StorageBackend = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('async storage full')
      },
      removeItem: async () => {},
    }
    const storage = createHybridStorage(secure, asyncStorage, ['token'])

    await expect(storage.setItem('key', JSON.stringify({ state: { token: 'x', other: 1 } }))).rejects.toThrow(
      'async storage full'
    )

    expect(secure.data.has('key_secure')).toBe(false)
  })

  it('removes both entries on removeItem', async () => {
    const secure = makeFakeBackend()
    const asyncStorage = makeFakeBackend()
    const storage = createHybridStorage(secure, asyncStorage, ['token'])

    await storage.setItem('key', JSON.stringify({ state: { token: 'x', other: 1 } }))
    await storage.removeItem('key')

    expect(secure.data.has('key_secure')).toBe(false)
    expect(asyncStorage.data.has('key')).toBe(false)
  })
})
