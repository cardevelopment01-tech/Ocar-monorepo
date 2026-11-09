import AsyncStorage from '@react-native-async-storage/async-storage'

// The online session id, kept on disk. The session store is memory-only (the server is the truth and the app re-derives it on start), but the
// location task can wake the app in a bare background process after Android killed it, before anything has re-derived the session: without
// this the task has no session id and sends neither positions nor heartbeats, and the driver goes quiet on the server.
// The server ignores a stale id (a heartbeat or fix for a session that is not the driver's current one changes nothing), so a leftover value is harmless.
const KEY = 'ocar_driver_session_id'

export async function readPersistedSessionId(): Promise<string | null> {
  try { return (await AsyncStorage.getItem(KEY)) || null } catch { return null }
}
export function persistSessionId(id: string): void {
  void AsyncStorage.setItem(KEY, id).catch(() => {})
}
export function clearPersistedSessionId(): void {
  void AsyncStorage.removeItem(KEY).catch(() => {})
}
