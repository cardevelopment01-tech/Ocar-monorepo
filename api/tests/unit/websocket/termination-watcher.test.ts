import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startTerminationWatcher } from '@/websocket/termination-watcher'

function res(status: number, body = ''): Response {
  return { status, ok: status >= 200 && status < 300, text: async () => body } as unknown as Response
}

// Answers the IMDSv2 token request, then the lifecycle state request from a script of states.
function fakeImds(states: Array<string | number | Error>) {
  let i = 0
  const calls: Array<{ url: string; method: string }> = []
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.endsWith('/latest/api/token')) return res(200, 'tok-123')
    const next = states[Math.min(i++, states.length - 1)]!
    if (next instanceof Error) throw next
    if (typeof next === 'number') return res(next)
    return res(200, next)
  })
  return { fetchFn: fetchFn as unknown as typeof fetch, calls }
}

describe('startTerminationWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onTerminating once, when the state becomes Terminated', async () => {
    const { fetchFn } = fakeImds(['InService', 'InService', 'Terminated', 'Terminated'])
    const onTerminating = vi.fn()
    startTerminationWatcher(onTerminating, { intervalMs: 1000, fetchFn })

    await vi.advanceTimersByTimeAsync(1500)
    expect(onTerminating).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(onTerminating).toHaveBeenCalledTimes(1)
  })

  it('uses IMDSv2: a PUT for the token, then the token on the state request', async () => {
    const { fetchFn, calls } = fakeImds(['InService'])
    startTerminationWatcher(vi.fn(), { intervalMs: 1000, fetchFn })
    await vi.advanceTimersByTimeAsync(10)

    expect(calls[0]).toEqual({ url: 'http://169.254.169.254/latest/api/token', method: 'PUT' })
    const stateCall = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[1]!
    expect(stateCall[0]).toBe('http://169.254.169.254/latest/meta-data/autoscaling/target-lifecycle-state')
    expect((stateCall[1] as RequestInit).headers).toEqual({ 'X-aws-ec2-metadata-token': 'tok-123' })
  })

  it('ignores 404 (no value yet), network errors and other states, and keeps watching', async () => {
    const { fetchFn } = fakeImds([404, new Error('ECONNREFUSED'), 'Detached', 'Terminated'])
    const onTerminating = vi.fn()
    startTerminationWatcher(onTerminating, { intervalMs: 1000, fetchFn })

    await vi.advanceTimersByTimeAsync(3500)
    expect(onTerminating).toHaveBeenCalledTimes(1)
  })

  it('stop() ends the polling', async () => {
    const { fetchFn } = fakeImds(['InService'])
    const watcher = startTerminationWatcher(vi.fn(), { intervalMs: 1000, fetchFn })
    await vi.advanceTimersByTimeAsync(10)
    watcher.stop()
    const callsAfterStop = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterStop)
  })
})
