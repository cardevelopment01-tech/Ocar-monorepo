// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { coverCrop, prepareBroadcastImage, ImageProblem, TARGET_BYTES } from '../broadcast-image'

// Value: protects=whatever picture an admin picks (a phone photo, a tall poster, a wide banner, a transparent PNG) leaves the browser as a
// centred 2:1 JPEG of 1024x512 well under Firebase's 1 MB limit, or is refused with a reason in words; fails_when=the crop is off-centre or
// the wrong shape, the size loop gives up too early or ships an oversized file, a transparent PNG goes black, or a too-small or unreadable
// file is let through; why_new=the admin used to paste a link to a picture they had to size and host themselves; seam=the browser's image
// decoder and canvas are replaced; no_claim=how the result looks, real JPEG encoding.

describe('coverCrop (the centred part of the picture that is kept)', () => {
  it('a wide picture loses its sides, evenly', () => {
    expect(coverCrop(3000, 1000)).toEqual({ sx: 500, sy: 0, sw: 2000, sh: 1000 })
  })
  it('a tall picture (a phone photo) loses top and bottom, evenly', () => {
    expect(coverCrop(1000, 3000)).toEqual({ sx: 0, sy: 1250, sw: 1000, sh: 500 })
  })
  it('a picture that is already 2:1 is kept whole', () => {
    expect(coverCrop(2048, 1024)).toEqual({ sx: 0, sy: 0, sw: 2048, sh: 1024 })
  })
  it('always has the target shape and stays inside the picture', () => {
    for (const [w, h] of [[4032, 3024], [1080, 1920], [600, 600], [1500, 700], [513, 7000]] as const) {
      const { sx, sy, sw, sh } = coverCrop(w, h)
      expect(Math.abs(sw / sh - 2)).toBeLessThan(0.01)
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sy).toBeGreaterThanOrEqual(0)
      expect(sx + sw).toBeLessThanOrEqual(w)
      expect(sy + sh).toBeLessThanOrEqual(h)
    }
  })
})

describe('prepareBroadcastImage', () => {
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  let toBlobSizes: number[]
  let toBlobQualities: number[]
  let bitmap: { width: number; height: number; close: () => void }

  beforeEach(() => {
    vi.clearAllMocks()
    bitmap = { width: 4032, height: 3024, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    toBlobSizes = [300_000]
    toBlobQualities = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect, fillStyle: '' } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, _type?: string, quality?: unknown) {
      toBlobQualities.push(Number(quality))
      const size = toBlobSizes[Math.min(toBlobQualities.length - 1, toBlobSizes.length - 1)]!
      cb(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }))
    } as HTMLCanvasElement['toBlob'])
    URL.createObjectURL = vi.fn(() => 'blob:preview')
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const file = (type = 'image/jpeg', size = 1000) => new File([new Uint8Array(size)], 'p.jpg', { type })

  it('crops the centre to 2:1, draws it at 1024x512 on white, and gives back a JPEG with a preview link', async () => {
    const out = await prepareBroadcastImage(file())
    expect(out).toMatchObject({ width: 1024, height: 512, previewUrl: 'blob:preview' })
    expect(out.blob.type).toBe('image/jpeg')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1024, 512) // white behind a transparent PNG
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls[0]!
    expect([sx, sy, sw, sh]).toEqual([0, 504, 4032, 2016]) // centred
    expect([dx, dy, dw, dh]).toEqual([0, 0, 1024, 512])
    expect(bitmap.close).toHaveBeenCalled() // memory released
  })

  it('takes the best quality that fits the byte target: a busy picture is squeezed step by step', async () => {
    toBlobSizes = [700_000, 520_000, TARGET_BYTES - 1]
    const out = await prepareBroadcastImage(file())
    expect(toBlobQualities).toEqual([0.88, 0.8, 0.72])
    expect(out.blob.size).toBe(TARGET_BYTES - 1)
  })

  it('refuses a picture that stays far too big at the lowest quality instead of uploading it', async () => {
    toBlobSizes = [950_000]
    await expect(prepareBroadcastImage(file())).rejects.toThrow(/too detailed/)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('accepts a file a little over the target at the lowest quality (still well under 1 MB)', async () => {
    toBlobSizes = [600_000]
    expect((await prepareBroadcastImage(file())).blob.size).toBe(600_000)
  })

  it('refuses, in words, a type it cannot take, a huge file, an unreadable one, and one that is too small', async () => {
    await expect(prepareBroadcastImage(file('image/gif'))).rejects.toBeInstanceOf(ImageProblem)
    await expect(prepareBroadcastImage(file('application/pdf'))).rejects.toThrow(/JPEG, PNG or WebP/)
    await expect(prepareBroadcastImage(file('image/jpeg', 21 * 1024 * 1024))).rejects.toThrow(/over 20 MB/)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('corrupt') }))
    await expect(prepareBroadcastImage(file())).rejects.toThrow(/could not be read/)
    bitmap = { width: 300, height: 200, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    await expect(prepareBroadcastImage(file())).rejects.toThrow(/only 300 pixels wide/)
    expect(bitmap.close).toHaveBeenCalled() // released even when refused
  })
})
