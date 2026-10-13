import { api } from './index'

// Several hooks on the same screen (tab layout gate + Home gate + Profile gate + profile photo) all
// GET the same URL in the same render pass. Callers arriving while a request is in flight share
// it; nothing is kept once it settles, so a later read after an upload is always fresh.
const inFlight = new Map<string, Promise<unknown>>()

export function sharedGet<T>(url: string): Promise<T> {
  const pending = inFlight.get(url)
  if (pending) return pending as Promise<T>
  const request = api
    .get<T>(url)
    .then((res) => res.data)
    .finally(() => { inFlight.delete(url) })
  inFlight.set(url, request)
  return request
}
