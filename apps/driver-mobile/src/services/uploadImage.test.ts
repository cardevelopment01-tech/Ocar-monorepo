import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal fake of expo-image-manipulator's contextual API: each manipulate()
// returns a context whose renderAsync() yields an ImageRef of the given size.
const state = vi.hoisted(() => ({
  size: { width: 4000, height: 3000 },
  savedUri: 'file:///cache/out.jpg',
  resizeCalls: [] as unknown[],
  released: 0,
  fail: false,
}))

vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      if (state.fail) throw new Error('native failure')
      return {
        resize: (t: unknown) => { state.resizeCalls.push(t) },
        release: () => { state.released++ },
        renderAsync: async () => ({
          ...state.size,
          release: () => { state.released++ },
          saveAsync: async (opts: unknown) => ({ uri: state.savedUri, opts }),
        }),
      }
    },
  },
}))

const getInfoAsync = vi.hoisted(() => vi.fn())
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync }))

const { fitWithin, prepareImageForUpload } = await import('./uploadImage')

beforeEach(() => {
  state.size = { width: 4000, height: 3000 }
  state.resizeCalls = []
  state.released = 0
  state.fail = false
  getInfoAsync.mockReset().mockResolvedValue({ exists: true, size: 250_000 })
})

describe('fitWithin', () => {
  it('caps the longer edge of a landscape photo', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: null })
  })
  it('caps the longer edge of a portrait photo', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: null, height: 1600 })
  })
  it('never upscales an already-small image', () => {
    expect(fitWithin(1600, 900)).toBeNull()
    expect(fitWithin(800, 600)).toBeNull()
  })
})

describe('prepareImageForUpload', () => {
  const photo = { uri: 'file:///dl.png', mimeType: 'image/png', fileSize: 3_000_000 }

  it('downscales a large photo, re-encodes to JPEG and reports the real on-disk size', async () => {
    const out = await prepareImageForUpload(photo)
    expect(state.resizeCalls).toEqual([{ width: 1600, height: null }])
    // content_length for the presigned PUT must come from disk, not the input
    expect(out).toEqual({ uri: 'file:///cache/out.jpg', mimeType: 'image/jpeg', fileSize: 250_000 })
  })

  it('releases every native ref and context (2 contexts + 2 rendered images)', async () => {
    await prepareImageForUpload(photo)
    expect(state.released).toBe(4)
  })

  it('re-encodes but does not resize an already-small photo', async () => {
    state.size = { width: 1200, height: 900 }
    const out = await prepareImageForUpload(photo)
    expect(state.resizeCalls).toEqual([])
    expect(out.mimeType).toBe('image/jpeg')
  })

  it('passes PDFs through untouched', async () => {
    const pdf = { uri: 'file:///rc.pdf', mimeType: 'application/pdf', fileSize: 123 }
    expect(await prepareImageForUpload(pdf)).toBe(pdf)
  })

  it('falls back to the original file if the manipulator fails', async () => {
    state.fail = true
    expect(await prepareImageForUpload(photo)).toBe(photo)
  })

  it('falls back to the original file if the output size cannot be read', async () => {
    getInfoAsync.mockResolvedValue({ exists: false })
    expect(await prepareImageForUpload(photo)).toBe(photo)
  })
})
