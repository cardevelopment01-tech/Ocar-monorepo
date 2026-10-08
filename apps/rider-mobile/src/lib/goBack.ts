import type { Href } from 'expo-router'

type BackRouter = { canGoBack: () => boolean; back: () => void; replace: (href: Href) => void }

/** `router.back()`, except a screen opened cold (deep link, notification tap, state restore) has nothing behind it
 *  and `back()` would log "GO_BACK was not handled" and do nothing: go to `fallback` instead. */
export function goBack(router: BackRouter, fallback: Href = '/(tabs)/home') {
  if (router.canGoBack()) router.back()
  else router.replace(fallback)
}
