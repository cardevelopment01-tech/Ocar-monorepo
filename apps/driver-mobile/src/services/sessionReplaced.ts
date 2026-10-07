import { Alert } from 'react-native'
import { useAuthStore } from '@/store/useAuthStore'

// Fired by both the REST client (401 AUTH_SESSION_REPLACED) and the socket
// (session:replaced), often together -- only alert once per signed-in session.
export function handleSessionReplaced(): void {
  if (!useAuthStore.getState().isAuthenticated) return
  useAuthStore.getState().clearAuth()
  Alert.alert('Logged out', 'Your account was signed in on another device, so you were logged out here.')
}
