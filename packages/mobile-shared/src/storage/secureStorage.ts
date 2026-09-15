import * as SecureStore from 'expo-secure-store'

// expo-secure-store throws (not just warns, on recent SDKs) past a ~2048-byte value --
// only store tokens and a small identity blob here, never full profile/history objects.
const MAX_VALUE_BYTES = 2048

export class SecureStorageValueTooLargeError extends Error {}

function assertWithinLimit(key: string, value: string): void {
  if (value.length > MAX_VALUE_BYTES) {
    throw new SecureStorageValueTooLargeError(
      `SecureStore value for "${key}" is ${value.length} bytes, exceeding the ${MAX_VALUE_BYTES}-byte limit`
    )
  }
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  assertWithinLimit(key, value)
  await SecureStore.setItemAsync(key, value)
}

export async function getSecureItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key)
}

export async function deleteSecureItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key)
}

export async function setSecureJSON<T>(key: string, value: T): Promise<void> {
  await setSecureItem(key, JSON.stringify(value))
}

export async function getSecureJSON<T>(key: string): Promise<T | null> {
  const raw = await getSecureItem(key)
  if (!raw) return null
  return JSON.parse(raw) as T
}
