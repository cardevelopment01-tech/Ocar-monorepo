import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
import { api } from '@/services/api'

// The trip receipt PDF is drawn by the server (GET /rides/:id/receipt.pdf, rider only). It goes through the shared api client so the
// auth header, token refresh and upgrade handling all apply, and is written to the cache folder.
export async function fetchReceiptFile(rideId: string): Promise<string> {
  const res = await api.get<ArrayBuffer>(`/api/v1/rides/${encodeURIComponent(rideId)}/receipt.pdf`, { responseType: 'arraybuffer' })
  const file = new File(Paths.cache, `Ocar-receipt-${rideId}.pdf`)
  if (file.exists) file.delete()
  file.create()
  file.write(new Uint8Array(res.data))
  return file.uri
}

// The system share sheet (save to Files, WhatsApp, email, print). Used on iOS, whose share sheet shows a preview of the PDF with
// "Save to Files", and as the fallback on Android.
async function shareFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device')
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Your Ocar receipt' })
}

// Opens the receipt the way other apps do: in the phone's own PDF viewer, where the rider can save, print or share it.
// Android hands the file to whichever PDF app is installed (a view request with read permission on a content:// address; a file:// address
// cannot be shared with another app). If the phone has no PDF app, or the handoff fails, the share sheet is the fallback.
// iOS uses the share sheet (expo-file-system's File.preview, which uses Quick Look, only exists from SDK 58).
export async function openReceipt(rideId: string): Promise<void> {
  const uri = await fetchReceiptFile(rideId)
  if (Platform.OS === 'android') {
    try {
      const contentUri = await getContentUriAsync(uri)
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: the viewer may read this one file
        type: 'application/pdf',
      })
      return
    } catch {
      // fall through to the share sheet
    }
  }
  await shareFile(uri)
}
