// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const post = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ default: { post, get: vi.fn() } }))

import { broadcastApi } from '../broadcast-api'

// Value: protects=the picture really reaches the server as a file; fails_when=the shared client's default JSON content type is left on the
// upload (the server then sees no file: "Choose a picture to upload"), the field is not called "image", or a large upload gets the short
// default timeout; why_new=found in a real browser run: every component test replaced this call, so nothing checked how it is sent;
// seam=the HTTP client is replaced; no_claim=a real network request.
describe('broadcastApi.uploadImage', () => {
  beforeEach(() => { vi.clearAllMocks(); post.mockResolvedValue({ data: { url: 'https://pics.example.com/broadcasts/a.jpg', width: 1024, height: 512, bytes: 100 } }) })

  it('sends the picture as multipart form data in a field called "image", with a timeout fit for a file', async () => {
    const blob = new Blob(['jpegbytes'], { type: 'image/jpeg' })
    const res = await broadcastApi.uploadImage(blob)
    expect(res.url).toBe('https://pics.example.com/broadcasts/a.jpg')
    const [url, form, config] = post.mock.calls[0]!
    expect(url).toBe('/api/v1/admin/notifications/broadcast-image')
    expect(form).toBeInstanceOf(FormData)
    expect((form as FormData).get('image')).toBeInstanceOf(Blob)
    expect(config.headers['Content-Type']).toBe('multipart/form-data')
    expect(config.timeout).toBeGreaterThanOrEqual(30000)
  })
})
