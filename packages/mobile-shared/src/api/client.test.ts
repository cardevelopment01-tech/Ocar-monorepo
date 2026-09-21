import { afterEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { MissingRefreshTokenError, createTokenRefresher } from './client'

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}))

const mockedPost = vi.mocked(axios.post)

afterEach(() => {
  mockedPost.mockReset()
})

// This dedup guarantee is the actual fix for a real bug: rider-mobile's
// socket (auto-connects at app launch) and its REST client (fired by the
// just-mounted home/trips screens) each used to run their OWN independent
// refresh against the SAME stale, rotating refresh token. The backend
// treats a second use of an already-consumed refresh token as theft and
// revokes the whole token family -- so the loser of that race force-logged
// the session out even though the winner had just succeeded. Sharing one
// refresher (this in-flight-promise guard) between both transports means
// there is only ever one call in flight to race against.
describe('createTokenRefresher', () => {
  it('shares one in-flight request across concurrent callers instead of firing one each', async () => {
    let resolvePost!: (value: { data: { tokens: { accessToken: string; refreshToken: string } } }) => void
    mockedPost.mockReturnValue(new Promise((resolve) => { resolvePost = resolve }))

    const onTokensRefreshed = vi.fn()
    const refresher = createTokenRefresher({
      baseURL: 'https://api.test',
      getRefreshToken: () => 'stale-refresh-token',
      onTokensRefreshed,
    })

    // Two callers firing "at the same time" -- exactly what the socket's
    // connect_error handler and the REST client's request interceptor do on
    // a cold launch when both see the same stale access token.
    const first = refresher.refreshAccessToken()
    const second = refresher.refreshAccessToken()

    expect(mockedPost).toHaveBeenCalledTimes(1)

    resolvePost({ data: { tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' } } })
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toBe('new-access')
    expect(secondResult).toBe('new-access')
    expect(mockedPost).toHaveBeenCalledTimes(1)
    expect(onTokensRefreshed).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh request for the next refresh once the in-flight one settles', async () => {
    mockedPost.mockResolvedValue({ data: { tokens: { accessToken: 'a1', refreshToken: 'r1' } } })
    const refresher = createTokenRefresher({
      baseURL: 'https://api.test',
      getRefreshToken: () => 'token',
      onTokensRefreshed: vi.fn(),
    })

    await refresher.refreshAccessToken()
    await refresher.refreshAccessToken()

    expect(mockedPost).toHaveBeenCalledTimes(2)
  })

  it('rejects with MissingRefreshTokenError when there is no refresh token to send, without calling the backend', async () => {
    const refresher = createTokenRefresher({
      baseURL: 'https://api.test',
      getRefreshToken: () => null,
      onTokensRefreshed: vi.fn(),
    })

    await expect(refresher.refreshAccessToken()).rejects.toBeInstanceOf(MissingRefreshTokenError)
    expect(mockedPost).not.toHaveBeenCalled()
  })
})
