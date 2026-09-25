import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/uploadImage', () => ({
  prepareImageForUpload: async (f: { uri: string; mimeType: string }) =>
    f.mimeType.startsWith('image/') ? { uri: `${f.uri}.small`, mimeType: 'image/jpeg', fileSize: 1000 } : f,
}))

const posts = vi.hoisted(() => [] as Array<{ url: string; body: Record<string, unknown> }>)
vi.mock('@/services/api', () => ({
  api: {
    post: async (url: string, body: Record<string, unknown>) => {
      posts.push({ url, body })
      return { data: url.endsWith('upload-init') ? { upload_url: 'https://s3/put', key: 'k1' } : { doc_type: 'x', file_url: 'u', status: 'pending' } }
    },
  },
}))

const fetched = vi.hoisted(() => [] as string[])
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  fetched.push(url)
  return url.startsWith('https://s3/') ? { ok: true } : { blob: async () => 'blob' }
}))

const { onboardingApi } = await import('./api')

beforeEach(() => { posts.length = 0; fetched.length = 0 })

describe('onboarding uploads use the downscaled file', () => {
  it('uploadDriverDoc signs and uploads the prepared file', async () => {
    await onboardingApi.uploadDriverDoc({ uri: 'dl', mimeType: 'image/heic', fileSize: 4_000_000 }, 'driving_license')
    expect(posts[0]).toEqual({
      url: '/api/v1/drivers/onboarding/documents/upload-init',
      body: { doc_type: 'driving_license', content_type: 'image/jpeg', content_length: 1000 },
    })
    expect(fetched[0]).toBe('dl.small')
  })

  it('uploadVehicleDoc passes a PDF through at its original size', async () => {
    await onboardingApi.uploadVehicleDoc({ uri: 'rc', mimeType: 'application/pdf', fileSize: 500_000 }, 'rc')
    expect(posts[0]!.body).toEqual({ doc_type: 'rc', content_type: 'application/pdf', content_length: 500_000 })
    expect(fetched[0]).toBe('rc')
  })
})
