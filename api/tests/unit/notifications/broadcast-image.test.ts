import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jpegBytes, pngBytes } from '../../helpers/images'

const storage = vi.hoisted(() => ({ configured: true, base: 'https://pics.example.com', upload: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  isPublicImageStorageConfigured: () => storage.configured,
  publicImageBaseUrl: () => storage.base,
  uploadPublicImage: (...a: unknown[]) => storage.upload(...a),
}))

import { isCompleteImage, readImageInfo } from '@/lib/image-info'
import { saveBroadcastImage, BROADCAST_IMAGE_MAX_BYTES } from '@/modules/notifications/broadcast-image.service'

// Value: protects=only a real, small, banner-shaped JPEG or PNG ever reaches the public pictures bucket, judged by its own bytes (not its
// name or the type the browser claimed), and the feature is off, with a clear message, until the bucket is configured;
// fails_when=a text/script/GIF file renamed .jpg gets through, an oversized or wrong-shaped picture is stored, the stored file's extension
// follows the uploaded name, or an unconfigured server writes anywhere; why_new=pictures were pasted links only, now the server stores files
// on behalf of an admin in a PUBLIC bucket, so what it accepts is a security boundary; seam=storage is replaced; no_claim=real S3, real decoding.

describe('readImageInfo', () => {
  it('reads the size of a PNG and of a JPEG (past the segments before the frame header)', () => {
    expect(readImageInfo(pngBytes(1024, 512))).toEqual({ type: 'png', width: 1024, height: 512 })
    expect(readImageInfo(jpegBytes(1024, 512))).toEqual({ type: 'jpeg', width: 1024, height: 512 })
  })

  it('refuses everything else: GIF, WebP, text, HTML, an SVG, a truncated header, nothing', () => {
    for (const bytes of [
      Buffer.from('GIF89a' + 'x'.repeat(40), 'latin1'),
      Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(30)]),
      Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512"></svg>', 'utf8'),
      pngBytes(1024, 512).subarray(0, 14),
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(0),
    ]) {
      expect(readImageInfo(bytes)).toBeNull()
    }
  })

  it('a JPEG header that points past the end of the file does not loop or throw', () => {
    expect(readImageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(readImageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull() // a zero-length segment
  })
})

describe('isCompleteImage (a cut-off upload is caught)', () => {
  it('accepts files that end the way a whole JPEG and a whole PNG do (zero padding after a JPEG is fine)', () => {
    expect(isCompleteImage(jpegBytes(1024, 512), 'jpeg')).toBe(true)
    expect(isCompleteImage(jpegBytes(1024, 512, 5000), 'jpeg')).toBe(true)
    expect(isCompleteImage(pngBytes(1024, 512, 5000), 'png')).toBe(true)
  })
  it('refuses a file cut short', () => {
    const jpeg = jpegBytes(1024, 512)
    const png = pngBytes(1024, 512, 5000)
    expect(isCompleteImage(jpeg.subarray(0, jpeg.length - 2), 'jpeg')).toBe(false)
    expect(isCompleteImage(png.subarray(0, png.length - 12), 'png')).toBe(false)
    expect(isCompleteImage(Buffer.alloc(0), 'jpeg')).toBe(false)
  })
})

describe('saveBroadcastImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.configured = true
    storage.base = 'https://pics.example.com'
    storage.upload.mockResolvedValue('https://pics.example.com/broadcasts/abc.jpg')
  })
  const file = (buffer: Buffer) => ({ buffer, size: buffer.length })

  it('stores a 2:1 JPEG and says where it is', async () => {
    const buf = jpegBytes(1024, 512, 150_000)
    expect(await saveBroadcastImage(file(buf))).toEqual({ url: 'https://pics.example.com/broadcasts/abc.jpg', width: 1024, height: 512, bytes: 150_000 })
    expect(storage.upload).toHaveBeenCalledWith(buf, 'image/jpeg', 'jpg', 'broadcasts')
  })

  it('names the stored file by what the bytes are (a PNG is .png even if it was uploaded as .jpg)', async () => {
    await saveBroadcastImage(file(pngBytes(800, 400)))
    expect(storage.upload).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', 'png', 'broadcasts')
  })

  it('is off, with a message that says what to do, until the bucket is configured, and writes nothing', async () => {
    storage.configured = false
    await expect(saveBroadcastImage(file(jpegBytes(1024, 512)))).rejects.toMatchObject({ httpStatus: 503, appCode: 'IMAGE_UPLOAD_NOT_CONFIGURED', message: expect.stringContaining('Paste a link') })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('refuses to store anything when the pictures address is not a public https one (uploads would work, every send would then fail)', async () => {
    for (const base of ['http://127.0.0.1:9099/bucket', 'http://cdn.example.com', 'https://localhost/pics', 'https://10.0.0.7/pics', 'https://intranet']) {
      storage.base = base
      await expect(saveBroadcastImage(file(jpegBytes(1024, 512))), base).rejects.toMatchObject({ httpStatus: 503, appCode: 'IMAGE_UPLOAD_NOT_CONFIGURED', message: expect.stringContaining('BROADCAST_IMAGE_BASE_URL') })
    }
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('refuses a missing file, an oversized one, and one that is not a JPEG or PNG', async () => {
    await expect(saveBroadcastImage(undefined)).rejects.toMatchObject({ httpStatus: 422 })
    await expect(saveBroadcastImage(file(jpegBytes(1024, 512, BROADCAST_IMAGE_MAX_BYTES + 1)))).rejects.toMatchObject({ httpStatus: 422, appCode: 'FILE_TOO_LARGE' })
    await expect(saveBroadcastImage(file(Buffer.from('GIF89a' + 'x'.repeat(100), 'latin1')))).rejects.toMatchObject({ httpStatus: 422, appCode: 'UNSUPPORTED_FILE_TYPE' })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('refuses a picture whose header looks right but whose file is cut off, and stores nothing', async () => {
    const whole = jpegBytes(1024, 512, 5000)
    await expect(saveBroadcastImage(file(Buffer.concat([whole.subarray(0, 60), Buffer.from([1, 2, 3, 4])])))).rejects.toMatchObject({ httpStatus: 422, message: expect.stringContaining('incomplete') })
    const png = pngBytes(1024, 512, 5000)
    await expect(saveBroadcastImage(file(png.subarray(0, png.length - 12)))).rejects.toMatchObject({ httpStatus: 422 })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('refuses a picture that is too small, too big, or not a wide banner', async () => {
    for (const [w, h] of [[400, 200], [4000, 2000], [1024, 1024], [512, 1024], [1024, 300]] as const) {
      await expect(saveBroadcastImage(file(jpegBytes(w, h))), `${w}x${h}`).rejects.toMatchObject({ httpStatus: 422 })
    }
    expect(storage.upload).not.toHaveBeenCalled()
    await expect(saveBroadcastImage(file(jpegBytes(1000, 500)))).resolves.toBeTruthy() // exactly 2:1
    await expect(saveBroadcastImage(file(jpegBytes(1024, 540)))).resolves.toBeTruthy() // a little slack
  })

  it('lets a storage failure through as an error (the route answers 500, nothing half-saved is reported as a success)', async () => {
    storage.upload.mockRejectedValueOnce(new Error('s3 down'))
    await expect(saveBroadcastImage(file(jpegBytes(1024, 512)))).rejects.toThrow('s3 down')
  })
})
