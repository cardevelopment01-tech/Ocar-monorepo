import { describe, it, expect, vi, beforeEach } from 'vitest'

// Value: protects=tapping "View receipt" on Android opens the PDF in the phone's own PDF viewer (a view request on a content:// address with
// read permission and the PDF type), falls back to the share sheet when the phone has no PDF app, and iOS keeps the share sheet; fails_when=
// Android goes to the share sheet first, the viewer is handed a file:// address or no read permission, a missing PDF app shows an error
// instead of the share sheet, or iOS tries the Android request; why_new=the button used to always open the share sheet; seam=the native
// modules and the API client are replaced; no_claim=a real phone (that is the debug-app test).

const m = vi.hoisted(() => ({
  os: 'android',
  get: vi.fn(),
  contentUri: vi.fn(),
  start: vi.fn(),
  shareAvailable: vi.fn(),
  share: vi.fn(),
}))
vi.mock('react-native', () => ({ Platform: { get OS() { return m.os } } }))
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class { uri = 'file:///cache/Ocar-receipt-77.pdf'; exists = false; delete() {} create() {} write() {} },
}))
vi.mock('expo-file-system/legacy', () => ({ getContentUriAsync: m.contentUri }))
vi.mock('expo-intent-launcher', () => ({ startActivityAsync: m.start }))
vi.mock('expo-sharing', () => ({ isAvailableAsync: m.shareAvailable, shareAsync: m.share }))
vi.mock('@/services/api', () => ({ api: { get: m.get } }))

import { openReceipt } from './receiptFile'

describe('openReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.os = 'android'
    m.get.mockResolvedValue({ data: new ArrayBuffer(8) })
    m.contentUri.mockResolvedValue('content://com.ocar.fileprovider/cache/Ocar-receipt-77.pdf')
    m.start.mockResolvedValue({ resultCode: -1 })
    m.shareAvailable.mockResolvedValue(true)
    m.share.mockResolvedValue(undefined)
  })

  it('Android: opens the PDF in the phone viewer with a content:// address, read permission and the PDF type, and does not open the share sheet', async () => {
    await openReceipt('77')
    expect(m.get).toHaveBeenCalledWith('/api/v1/rides/77/receipt.pdf', { responseType: 'arraybuffer' })
    expect(m.contentUri).toHaveBeenCalledWith('file:///cache/Ocar-receipt-77.pdf')
    expect(m.start).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://com.ocar.fileprovider/cache/Ocar-receipt-77.pdf',
      flags: 1,
      type: 'application/pdf',
    })
    expect(m.share).not.toHaveBeenCalled()
  })

  it('Android with no PDF app (the request fails): falls back to the share sheet instead of an error', async () => {
    m.start.mockRejectedValue(new Error('No Activity found to handle Intent'))
    await expect(openReceipt('77')).resolves.toBeUndefined()
    expect(m.share).toHaveBeenCalledWith('file:///cache/Ocar-receipt-77.pdf', expect.objectContaining({ mimeType: 'application/pdf' }))
  })

  it('Android when the content address cannot be made: also falls back to the share sheet', async () => {
    m.contentUri.mockRejectedValue(new Error('no provider'))
    await openReceipt('77')
    expect(m.start).not.toHaveBeenCalled()
    expect(m.share).toHaveBeenCalledTimes(1)
  })

  it('iOS: uses the share sheet and never makes the Android request', async () => {
    m.os = 'ios'
    await openReceipt('77')
    expect(m.start).not.toHaveBeenCalled()
    expect(m.contentUri).not.toHaveBeenCalled()
    expect(m.share).toHaveBeenCalledWith('file:///cache/Ocar-receipt-77.pdf', expect.objectContaining({ UTI: 'com.adobe.pdf' }))
  })

  it('a download failure is thrown, so the screen can say "Could not get the receipt"', async () => {
    m.get.mockRejectedValue(new Error('network'))
    await expect(openReceipt('77')).rejects.toThrow('network')
    expect(m.start).not.toHaveBeenCalled()
    expect(m.share).not.toHaveBeenCalled()
  })

  it('if sharing is not available on the device (iOS or the fallback) it throws', async () => {
    m.os = 'ios'
    m.shareAvailable.mockResolvedValue(false)
    await expect(openReceipt('77')).rejects.toThrow('Sharing is not available')
  })
})
