import { describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createApiClient, createTokenRefresher } from './client'

const appInfo = { app: 'driver', platform: 'android', version: '1.2.3', build: '7' }

function makeClient(respond: (cfg: InternalAxiosRequestConfig) => { status: number; data: unknown }, onUpgradeRequired = vi.fn()) {
  const api = createApiClient({
    baseURL: 'https://api.test',
    getAccessToken: () => null,
    refresher: createTokenRefresher({ baseURL: 'https://api.test', getRefreshToken: () => null, onTokensRefreshed: () => {} }),
    onAuthFailure: () => {},
    appInfo,
    onUpgradeRequired,
  })
  api.defaults.adapter = async (cfg) => {
    const { status, data } = respond(cfg)
    const res = { data, status, statusText: '', headers: {}, config: cfg }
    if (status >= 400) throw new AxiosError('fail', String(status), cfg, null, res)
    return res
  }
  return { api, onUpgradeRequired }
}

describe('createApiClient app identity', () => {
  it('sends the X-App-* headers on every request', async () => {
    let seen: Record<string, unknown> = {}
    const { api } = makeClient((cfg) => { seen = cfg.headers.toJSON(); return { status: 200, data: {} } })
    await api.get('/x')
    expect(seen).toMatchObject({ 'X-App-Name': 'driver', 'X-App-Platform': 'android', 'X-App-Version': '1.2.3', 'X-App-Build': '7' })
  })
  it('reports UPGRADE_REQUIRED once and still rejects the request', async () => {
    const { api, onUpgradeRequired } = makeClient(() => ({ status: 426, data: { code: 'UPGRADE_REQUIRED' } }))
    await expect(api.post('/rides/sessions/online')).rejects.toBeTruthy()
    expect(onUpgradeRequired).toHaveBeenCalledOnce()
  })
  it('ignores other errors', async () => {
    const { api, onUpgradeRequired } = makeClient(() => ({ status: 500, data: { code: 'INTERNAL_ERROR' } }))
    await expect(api.get('/x')).rejects.toBeTruthy()
    expect(onUpgradeRequired).not.toHaveBeenCalled()
  })
})
