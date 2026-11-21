import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { api } from '@/services/api'

// The trip receipt PDF is drawn by the server (GET /rides/:id/receipt.pdf, rider only). It goes through the shared api client so the
// auth header, token refresh and upgrade handling all apply, is written to the cache folder, then handed to the system share sheet
// (save to Files, WhatsApp, email, print).
export async function fetchReceiptFile(rideId: string): Promise<string> {
  const res = await api.get<ArrayBuffer>(`/api/v1/rides/${encodeURIComponent(rideId)}/receipt.pdf`, { responseType: 'arraybuffer' })
  const file = new File(Paths.cache, `Ocar-receipt-${rideId}.pdf`)
  if (file.exists) file.delete()
  file.create()
  file.write(new Uint8Array(res.data))
  return file.uri
}

export async function shareReceipt(rideId: string): Promise<void> {
  const uri = await fetchReceiptFile(rideId)
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device')
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Your Ocar receipt' })
}
