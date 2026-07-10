// Firebase Cloud Messaging background service worker.
// Handles push notifications while the Ocar admin portal is backgrounded/closed.
// NOTE: this file cannot read Next.js env vars (it's a static asset served
// as-is), so the Firebase config is passed in as query params on the SW
// registration URL (see registerPush() in lib/push.ts) and read back out
// of self.location.search here.

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js')

const params = new URLSearchParams(self.location.search)
firebase.initializeApp({
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Ocar'
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    data: payload.data || {},
  }
  self.registration.showNotification(title, options)
})
