import { describe, it, expect, vi } from 'vitest'

const events = vi.hoisted(() => [] as string[])

vi.mock('@/services/uploadImage', () => ({
  prepareImageForUpload: async (f: { uri: string }) => {
    events.push(`prepare:start:${f.uri}`)
    await new Promise((r) => setTimeout(r, 5))
    events.push(`prepare:end:${f.uri}`)
    return { ...f, uri: `${f.uri}.small`, fileSize: 1000 }
  },
}))

const posts = vi.hoisted(() => [] as Array<{ url: string; body: Record<string, unknown> }>)
vi.mock('@/services/api', () => ({
  api: {
    post: async (url: string, body: Record<string, unknown>) => {
      posts.push({ url, body })
      if (url.endsWith('upload-init')) return { data: { upload_url: `https://s3/${String(body['kind'])}`, key: `k-${String(body['kind'])}` } }
      return { data: { complete: true } }
    },
  },
}))

vi.stubGlobal('fetch', vi.fn(async (url: string) =>
  url.startsWith('https://s3/') ? { ok: true } : { blob: async () => 'blob' },
))

const { submitVerification } = await import('./api')

describe('submitVerification', () => {
  it('downscales selfie and plate one at a time, then uploads the small files', async () => {
    const selfie = { uri: 'selfie', mimeType: 'image/jpeg', fileSize: 3_000_000 }
    const plate = { uri: 'plate', mimeType: 'image/jpeg', fileSize: 3_000_000 }

    await expect(submitVerification(selfie, plate)).resolves.toEqual({ complete: true })

    // Never two full-res decodes in flight at once (low-end Android OOM)
    expect(events).toEqual(['prepare:start:selfie', 'prepare:end:selfie', 'prepare:start:plate', 'prepare:end:plate'])
    // upload-init is signed for the downscaled size, not the original
    const inits = posts.filter((p) => p.url.endsWith('upload-init'))
    expect(inits.map((p) => p.body['content_length'])).toEqual([1000, 1000])
    expect(posts.at(-1)).toEqual({ url: '/api/v1/drivers/daily-verification', body: { selfie_key: 'k-selfie', plate_key: 'k-plate' } })
  })
})
