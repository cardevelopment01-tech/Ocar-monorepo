import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }))

import { createTrailBuffer, MAX_BUFFERED_FIXES, type TrailFix } from './trailBuffer'

const fix = (i: number): TrailFix => ({ lat: 20 + i / 1e4, lng: 85, recordedAt: new Date(1_700_000_000_000 + i * 3000).toISOString() })
const fixes = (n: number, from = 0) => Array.from({ length: n }, (_, i) => fix(from + i))

function make(opts: { saved?: string | null; failWith?: unknown } = {}) {
  const disk = { value: opts.saved ?? null }
  const posts: Array<{ rideId: string; n: number; first: string }> = []
  let fail = opts.failWith
  let t = 1_000_000
  const buf = createTrailBuffer({
    load: async () => disk.value,
    save: async (v) => { disk.value = v },
    post: async (rideId, f) => { if (fail) throw fail; posts.push({ rideId, n: f.length, first: f[0]!.recordedAt }) },
    now: () => t,
  })
  return { buf, disk, posts, setFail: (e: unknown) => { fail = e }, tick: (ms: number) => { t += ms } }
}

const settle = () => new Promise((r) => setTimeout(r, 0)) // let the upload add() starts on its own finish

describe('trail buffer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('keeps nothing until a trip has started', async () => {
    const { buf, posts } = make()
    await buf.add(fixes(5))
    await buf.flush()
    expect(posts).toHaveLength(0)
  })

  it('uploads what it saved in batches of 300, oldest first, and empties itself', async () => {
    const { buf, posts, disk } = make()
    await buf.start('101')
    await buf.add(fixes(650))
    await buf.flush()
    expect(posts.map((p) => p.n)).toEqual([300, 300, 50])
    expect(posts[0]).toMatchObject({ rideId: '101', first: fix(0).recordedAt })
    expect(posts[1]!.first).toBe(fix(300).recordedAt)
    expect(JSON.parse(disk.value!).fixes).toHaveLength(0)
  })

  it('keeps everything when the network is down, and sends it on the next try', async () => {
    const { buf, posts, setFail } = make({ failWith: new Error('Network Error') })
    await buf.start('101')
    await buf.add(fixes(10))
    await settle()
    expect(posts).toHaveLength(0)
    setFail(undefined)
    await buf.flush()
    expect(posts).toEqual([{ rideId: '101', n: 10, first: fix(0).recordedAt }])
  })

  it('gives up on points the server refuses outright (4xx) instead of retrying forever', async () => {
    const { buf, posts, setFail } = make({ failWith: { response: { status: 404 } } })
    await buf.start('101')
    await buf.add(fixes(10))
    await settle()
    setFail(undefined)
    await buf.flush()
    expect(posts).toHaveLength(0)
  })

  it('keeps the trail on a temporary refusal (rate limit, timeout, expired token)', async () => {
    for (const status of [401, 408, 429]) {
      const { buf, posts, setFail } = make({ failWith: { response: { status } } })
      await buf.start('101')
      await buf.add(fixes(10))
      await settle()
      setFail(undefined)
      await buf.flush()
      expect(posts, `status ${status}`).toEqual([{ rideId: '101', n: 10, first: fix(0).recordedAt }])
    }
  })

  it('survives the app being killed: a new instance reads the saved trail', async () => {
    const a = make()
    await a.buf.start('101')
    await a.buf.add(fixes(4))
    await a.buf.flush() // forces a write of the current state
    await a.buf.add(fixes(3, 10)); a.tick(11_000); await a.buf.add(fixes(1, 20)) // the throttled write lands on the second add
    const b = make({ saved: a.disk.value })
    await b.buf.flush()
    expect(b.posts[0]).toMatchObject({ rideId: '101' })
    expect(b.posts[0]!.n).toBeGreaterThanOrEqual(3)
  })

  it('a different ride starts a fresh trail; the same ride keeps it', async () => {
    const { buf, posts } = make()
    await buf.start('101'); await buf.add(fixes(3))
    await buf.start('101'); await buf.flush()
    expect(posts[0]!.n).toBe(3)
    await buf.start('202'); await buf.add(fixes(2)); await buf.flush()
    expect(posts[1]).toMatchObject({ rideId: '202', n: 2 })
  })

  it('caps what it holds so a long outage cannot fill the phone', async () => {
    const { buf, posts, setFail } = make({ failWith: new Error('down') })
    await buf.start('101')
    await buf.add(fixes(MAX_BUFFERED_FIXES + 500))
    await settle()
    setFail(undefined)
    await buf.flush()
    expect(posts.reduce((a, p) => a + p.n, 0)).toBe(MAX_BUFFERED_FIXES)
    expect(posts[0]!.first).toBe(fix(500).recordedAt) // the oldest were dropped
  })

  it('end() sends the rest and forgets the ride', async () => {
    const { buf, posts } = make()
    await buf.start('101'); await buf.add(fixes(5))
    await buf.end()
    expect(posts).toHaveLength(1)
    await buf.add(fixes(5))
    await buf.flush()
    expect(posts).toHaveLength(1)
  })
})
