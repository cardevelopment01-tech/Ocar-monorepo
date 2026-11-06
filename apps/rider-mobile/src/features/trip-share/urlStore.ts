import { deleteSecureItem, getSecureItem, setSecureItem } from '@ocar/mobile-shared'
import { urlStorageKey } from './model'

// The server never stores a link, only a fingerprint of it, so the link a rider created lives only on this phone, in secure
// storage, keyed by the share's id. Losing it (reinstall, new phone) costs nothing but the "show it again" convenience:
// the rider creates a new link and can stop the old one from the list.

export async function saveShareUrl(shareId: string, url: string): Promise<void> {
  try { await setSecureItem(urlStorageKey(shareId), url) } catch { /* the link was already handed to the share sheet; only re-showing it is lost */ }
}

export async function loadShareUrls(shareIds: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(shareIds.map(async (id) => {
    try {
      const url = await getSecureItem(urlStorageKey(id))
      if (url) out[id] = url
    } catch { /* unreadable: treat as not stored */ }
  }))
  return out
}

export async function forgetShareUrl(shareId: string): Promise<void> {
  try { await deleteSecureItem(urlStorageKey(shareId)) } catch { /* nothing to forget */ }
}
