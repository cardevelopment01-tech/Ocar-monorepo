// load-tests/k6/lib/socketio.js
//
// Minimal Engine.IO v4 + Socket.IO v4 client, hand-rolled on top of k6's
// native `k6/ws` module.
//
// WHY THIS EXISTS INSTEAD OF A REAL SOCKET.IO CLIENT LIBRARY:
// k6 runs scripts in a JS runtime (goja), not Node or a browser — the real
// `socket.io-client` npm package doesn't run inside k6. k6's native `ws`
// module only speaks raw WebSocket frames, so to load-test a Socket.io
// server we have to speak its wire protocol ourselves. That protocol is
// small and stable (Engine.IO packet type digit + optional Socket.IO packet
// type digit + JSON), so hand-rolling it is standard practice for k6 against
// Socket.io — this is not a shortcut unique to this project.
//
// This client deliberately only supports what api/src/websocket/socket.server.ts
// actually needs:
//   - No polling transport — the server is configured `transports: ['websocket']`
//     only (see socket.server.ts), so we connect straight to the WS upgrade
//     endpoint and skip the HTTP long-polling handshake entirely.
//   - No reconnection/backoff logic — a dropped connection during the load
//     test is a real signal (report it), not something to paper over.
//   - No binary packets, no ack callbacks — nothing in this app's socket
//     surface (see socket.server.ts's socket.on(...) handlers) uses them.
//
// Engine.IO v4 packet types (single leading digit on the WS frame):
//   0 open   1 close   2 ping   3 pong   4 message   5 upgrade   6 noop
// Socket.IO packet types (leading digit right after a '4' EIO message):
//   0 connect   1 disconnect   2 event   3 ack   4 connect_error   5/6 binary
//
// IMPORTANT — heartbeat direction: Engine.IO v4 flipped this vs. v3. The
// SERVER sends ping (`2`), the CLIENT must reply pong (`3`) or the server
// drops the connection after `pingTimeout` (60s here — see socket.server.ts).
// This client auto-replies; you don't need to do anything for it to work.
//
// DRY-RUN THIS AGAINST STAGING BEFORE THE LIVE CLIENT SESSION.
// Protocol details are easy to get subtly wrong (e.g. a Postgres/pg version
// quirk is not the risk here, a Socket.io minor-version wire-format quirk is).
// Run `k6 run --vus 1 --iterations 1 smoke.js` first — see README.

import ws from 'k6/ws'
import { check } from 'k6'

/**
 * Opens an authenticated Socket.io connection and hands control to `onReady`
 * once the namespace CONNECT handshake completes. Blocks (in the k6 sense)
 * for the lifetime of the socket — same execution model as k6's own ws.connect.
 *
 * @param {string} wsUrl        e.g. "wss://staging.ocar.example.com/socket.io/?EIO=4&transport=websocket"
 * @param {string} token        JWT access token (from tokens.json)
 * @param {(conn: SocketIOConn) => void} onReady  called once, after the '40' ack
 * @param {(err: string) => void} [onError]
 */
export function connect(wsUrl, token, onReady, onError) {
  let acked = false
  let closedCleanly = false

  const res = ws.connect(wsUrl, {}, function (socket) {
    const conn = {
      raw: socket,
      emit(event, payload) {
        // '4' EIO message, '2' SIO event, then a JSON array [event, payload]
        socket.send('42' + JSON.stringify([event, payload]))
      },
      on(event, handler) {
        listeners[event] = handler
      },
      close() {
        closedCleanly = true
        socket.close()
      },
    }
    const listeners = {}

    socket.on('open', function () {
      // Server sends the EIO '0{...}' open packet automatically on connect;
      // nothing to send here. Wait for it in the message handler below.
    })

    socket.on('message', function (data) {
      const eio = data[0]
      const rest = data.slice(1)

      if (eio === '0') {
        // EIO open packet — now send the Socket.io CONNECT packet for the
        // default namespace, with our JWT in the auth payload (this is what
        // socket.server.ts's io.use() middleware reads as
        // socket.handshake.auth.token).
        socket.send('40' + JSON.stringify({ token }))
        return
      }
      if (eio === '2') {
        // Server ping -> we must pong or get dropped after pingTimeout.
        socket.send('3')
        return
      }
      if (eio === '6') {
        return // noop, ignore
      }
      if (eio !== '4') {
        return // upgrade/close packets — nothing to do for a WS-only transport
      }

      // EIO message wrapping a Socket.io packet.
      const sio = rest[0]
      const body = rest.slice(1)
      if (sio === '0') {
        // Socket.io CONNECT ack — handshake complete, namespace joined.
        acked = true
        onReady(conn)
        return
      }
      if (sio === '4') {
        const msg = 'Socket.io CONNECT_ERROR: ' + body
        if (onError) onError(msg)
        else console.error(msg)
        socket.close()
        return
      }
      if (sio === '2') {
        // Server -> client event: 2["event_name", payload]
        try {
          const parsed = JSON.parse(body)
          const [eventName, payload] = parsed
          if (listeners[eventName]) listeners[eventName](payload)
        } catch (e) {
          console.error('failed to parse socket.io event frame: ' + body)
        }
      }
    })

    socket.on('close', function () {
      if (!acked && !closedCleanly && onError) {
        onError('socket closed before CONNECT ack')
      }
    })

    socket.on('error', function (e) {
      if (onError) onError('ws error: ' + e.error())
    })
  })

  check(res, { 'socket.io: connected (101 upgrade)': (r) => r && r.status === 101 })
}
