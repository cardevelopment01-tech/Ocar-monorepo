// Web push registration via Firebase Cloud Messaging.
// Entirely gated on NEXT_PUBLIC_FIREBASE_PROJECT_ID — when unset (no Firebase
// project provisioned), every function here is a safe no-op that never throws.
import api from './api'
import { getToken } from './auth'

let firebaseAppPromise: Promise<import('firebase/app').FirebaseApp | null> | null = null

function isFirebaseConfigured(): boolean {
  return typeof window !== 'undefined' && !!process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']
}

function getFirebaseConfig() {
  return {
    apiKey: process.env['NEXT_PUBLIC_FIREBASE_API_KEY'] ?? '',
    authDomain: process.env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'] ?? '',
    projectId: process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'] ?? '',
    messagingSenderId: process.env['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'] ?? '',
    appId: process.env['NEXT_PUBLIC_FIREBASE_APP_ID'] ?? '',
  }
}

async function initFirebase(): Promise<import('firebase/app').FirebaseApp | null> {
  if (!isFirebaseConfigured()) return null

  if (!firebaseAppPromise) {
    firebaseAppPromise = (async () => {
      try {
        const { initializeApp, getApps, getApp } = await import('firebase/app')
        const firebaseConfig = getFirebaseConfig()
        return getApps().length ? getApp() : initializeApp(firebaseConfig)
      } catch (err) {
        console.error('[push] Firebase init failed:', err)
        return null
      }
    })()
  }

  return firebaseAppPromise
}

// The service worker is a static file and cannot read Next.js env vars, so
// the Firebase config is passed as query params on the SW registration URL
// and read back out of self.location.search inside the SW.
async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const firebaseConfig = getFirebaseConfig()
  const swParams = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  })
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swParams.toString()}`)
}

// Request notification permission, obtain an FCM token, and register it
// with the backend. Swallows all errors — must never throw into the caller.
export async function registerPush(): Promise<void> {
  if (!isFirebaseConfigured()) return
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return

  try {
    const app = await initFirebase()
    if (!app) return

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return

    const registration = await registerServiceWorker()

    const { getMessaging, getToken } = await import('firebase/messaging')
    const messaging = getMessaging(app)
    const vapidKey = process.env['NEXT_PUBLIC_FIREBASE_VAPID_KEY']

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    })
    if (!token) return

    await api.post('/api/v1/notifications/devices', { token, platform: 'web' })
  } catch (err) {
    console.error('[push] registerPush failed:', err)
  }
}

// Remove the current device's FCM token, both from the backend and locally.
// Must never throw into the caller and must never block/delay logout.
export async function unregisterPush(): Promise<void> {
  if (!isFirebaseConfigured()) return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  // Captured synchronously (before any await) because the caller clears local
  // auth state right after firing this off — by the time we'd otherwise read
  // it from storage, it would already be gone and the DELETE would 401 silently.
  const authToken = getToken()
  if (!authToken) return

  try {
    const app = await initFirebase()
    if (!app) return

    const { getMessaging, getToken: getFcmToken, deleteToken } = await import('firebase/messaging')
    const messaging = getMessaging(app)
    const registration = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
    const vapidKey = process.env['NEXT_PUBLIC_FIREBASE_VAPID_KEY']

    const fcmToken = await getFcmToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration ?? undefined,
    })
    if (fcmToken) {
      await api.delete('/api/v1/notifications/devices', {
        data: { token: fcmToken },
        headers: { Authorization: `Bearer ${authToken}` },
      })
      await deleteToken(messaging).catch(() => undefined)
    }
  } catch (err) {
    console.error('[push] unregisterPush failed:', err)
  }
}
