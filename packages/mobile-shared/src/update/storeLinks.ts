import { Linking, Platform } from 'react-native'
import Constants from 'expo-constants'

/**
 * Opens this app's store page. Android: the Play app (market://), falling back to the https page. iOS: the App
 * Store URL, once the app has one (`extra.iosAppStoreUrl` in app.json; null until iOS ships).
 * `writeReview` deep-links to the review form on iOS. It never triggers the in-app review dialog.
 * Returns false when there is nowhere to send the user.
 */
export async function openStorePage(
  httpsStoreUrl: string | null,
  opts: { writeReview?: boolean } = {},
): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const base = Constants.expoConfig?.extra?.['iosAppStoreUrl'] as string | undefined
    if (!base) return false
    await Linking.openURL(opts.writeReview ? `${base}?action=write-review` : base)
    return true
  }
  const pkg = Constants.expoConfig?.android?.package
  if (pkg) {
    try {
      await Linking.openURL(`market://details?id=${pkg}`)
      return true
    } catch { /* no Play Store app: fall through to the web page */ }
  }
  const url = httpsStoreUrl ?? (pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : null)
  if (!url) return false
  await Linking.openURL(url).catch(() => {})
  return true
}

/** Whether a "Rate Ocar" / "Update" link has a destination on this platform. */
export function hasStorePage(): boolean {
  return Platform.OS !== 'ios' || !!Constants.expoConfig?.extra?.['iosAppStoreUrl']
}
