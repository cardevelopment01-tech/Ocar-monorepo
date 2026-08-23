// Firebase Cloud Messaging background service worker.
// Handles push notifications while the Ocar driver app is backgrounded/closed.
// NOTE: this file cannot read Vite env vars (it's a static asset served
// as-is), so the Firebase config is passed in as query params on the SW
// registration URL (see registerPush() in src/lib/push.ts) and read back out
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
  // firebase-admin's MulticastMessage.webpush.notification.tag (set server-side
  // in push.provider.ts) arrives here on payload.notification.tag per the FCM
  // web payload shape — verify this empirically against a real FCM payload
  // during Task D's manual check; fall back to fcmOptions if the field differs.
  const tag = payload.notification?.tag || payload.fcmOptions?.tag
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    data: payload.data || {},
    ...(tag ? { tag, renotify: true } : {}),
  }
  self.registration.showNotification(title, options)
})

// Tapping the notification should focus the driver's already-open tab instead
// of opening a duplicate one — standard MDN service-worker pattern. Deep-links
// to event.notification.data.path (set server-side via notifyOwner's payload)
// so a backgrounded/closed-app tap lands on the relevant screen, not just '/'.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data?.path || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return 'navigate' in client ? client.navigate(path).then((c) => c.focus()) : client.focus()
        }
      }
      return clients.openWindow(path)
    })
  )
})
