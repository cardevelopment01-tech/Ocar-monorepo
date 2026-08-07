'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, Check, CheckCheck, Send } from 'lucide-react'
import { rideApi, type ChatMessage } from '@/lib/ride-api'
import { connectSocket, joinRideRoom, getSocket } from '@/lib/socket'

const EASE = [0.22, 1, 0.36, 1] as const

const CANNED_REPLIES = [
  'On my way',
  "I'm at the pickup point",
  'Running a few min late',
  "Can't find you, please call",
  'Here',
]

// Local send-lifecycle overlay on top of the server message shape. 'sending'/'failed'
// are client-only states for the bubble I just sent; the server never reports them.
type LocalStatus = 'sending' | 'sent' | 'failed'
type LocalMessage = ChatMessage & { localStatus?: LocalStatus }

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('')
}

const CLOSED_STATUSES = new Set(['completed', 'cancelled', 'no_drivers'])

type DriverInfo = { name: string | null; photo: string | null; rating: string | null }

export default function RideChatPage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router = useRouter()

  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [driver, setDriver] = useState<DriverInfo>({ name: null, photo: null, rating: null })
  const [rideStatus, setRideStatus] = useState<string | null>(null)
  const listEndRef = useRef<HTMLDivElement>(null)
  const lastSeenIdRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)
  const isClosed = rideStatus !== null && CLOSED_STATUSES.has(rideStatus)

  const scrollToBottom = useCallback((smooth = true) => {
    listEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // Merge a freshly-arrived server message into state: replace the optimistic
  // local echo (matched by clientMsgId) if present, otherwise append.
  const upsertMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.clientMsgId === msg.clientMsgId)
      if (idx === -1) return [...prev, { ...msg, localStatus: 'sent' }]
      const next = [...prev]
      next[idx] = { ...msg, localStatus: 'sent' }
      return next
    })
    lastSeenIdRef.current = msg.id
  }, [])

  useEffect(() => {
    if (!rideId) return
    connectSocket()
    const socket = getSocket()
    joinRideRoom(rideId)
    // Tells the server this screen is watching this ride's chat live, so a
    // new message doesn't also trigger a redundant push/in-app notification.
    socket.emit('chat:open', { rideId })

    let mounted = true
    mountedRef.current = true
    rideApi.getMessages(rideId).then(history => {
      if (!mounted) return
      setMessages(history.map(m => ({ ...m, localStatus: 'sent' })))
      if (history.length) lastSeenIdRef.current = history[history.length - 1]!.id
      void rideApi.markChatRead(rideId).catch(() => {})
    }).catch(() => {}).finally(() => setLoading(false))

    rideApi.getRide(rideId).then(ride => {
      if (!mounted) return
      setDriver({ name: ride.driver_name, photo: ride.driver_photo, rating: ride.driver_rating })
      setRideStatus(ride.status)
    }).catch(() => {})

    function onStatusUpdate(data: { status?: string }) {
      if (data.status && CLOSED_STATUSES.has(data.status)) {
        setRideStatus(data.status)
      }
    }

    function onChatMessage(msg: ChatMessage) {
      if (msg.rideId !== rideId) return
      upsertMessage(msg)
      if (msg.senderType === 'driver') void rideApi.markChatRead(rideId).catch(() => {})
    }

    function onChatRead({ rideId: msgRideId, readerType }: { rideId: string; readerType: 'user' | 'driver' }) {
      if (msgRideId !== rideId) return
      if (readerType !== 'driver') return
      setMessages(prev => prev.map(m => (m.senderType === 'user' ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m)))
    }

    function onReconnect() {
      rideApi.getMessages(rideId, lastSeenIdRef.current).then(caughtUp => {
        if (!mounted) return
        if (!caughtUp.length) return
        setMessages(prev => {
          const known = new Set(prev.map(m => m.clientMsgId))
          const fresh = caughtUp.filter(m => !known.has(m.clientMsgId)).map(m => ({ ...m, localStatus: 'sent' as const }))
          return fresh.length ? [...prev, ...fresh] : prev
        })
        lastSeenIdRef.current = caughtUp[caughtUp.length - 1]!.id
        if (caughtUp.some(m => m.senderType === 'driver')) void rideApi.markChatRead(rideId).catch(() => {})
      }).catch(() => {})
    }

    socket.on('chat:message', onChatMessage)
    socket.on('chat:read', onChatRead)
    socket.on('connect', onReconnect)
    socket.on('ride:status_update', onStatusUpdate)

    return () => {
      mounted = false
      mountedRef.current = false
      socket.emit('chat:close', { rideId })
      socket.off('chat:message', onChatMessage)
      socket.off('chat:read', onChatRead)
      socket.off('connect', onReconnect)
      socket.off('ride:status_update', onStatusUpdate)
    }
  }, [rideId, upsertMessage])

  useEffect(() => {
    scrollToBottom(false)
  }, [messages.length, scrollToBottom])

  async function send(body: string) {
    const trimmed = body.trim()
    if (!trimmed || !rideId) return
    const clientMsgId = crypto.randomUUID()
    const optimistic: LocalMessage = {
      id: clientMsgId,
      rideId,
      senderType: 'user',
      senderId: '',
      body: trimmed,
      clientMsgId,
      readAt: null,
      createdAt: new Date().toISOString(),
      localStatus: 'sending',
    }
    setMessages(prev => [...prev, optimistic])
    setInput('')

    try {
      const sent = await rideApi.sendMessage(rideId, trimmed, clientMsgId)
      if (!mountedRef.current) return
      upsertMessage(sent)
    } catch {
      if (!mountedRef.current) return
      setMessages(prev => prev.map(m => (m.clientMsgId === clientMsgId ? { ...m, localStatus: 'failed' } : m)))
    }
  }

  async function retry(msg: LocalMessage) {
    setMessages(prev => prev.map(m => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: 'sending' } : m)))
    try {
      const sent = await rideApi.sendMessage(rideId, msg.body, msg.clientMsgId)
      if (!mountedRef.current) return
      upsertMessage(sent)
    } catch {
      if (!mountedRef.current) return
      setMessages(prev => prev.map(m => (m.clientMsgId === msg.clientMsgId ? { ...m, localStatus: 'failed' } : m)))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void send(input)
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 bg-surface border-b border-border">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0 bg-background"
        >
          <ChevronLeft size={18} className="text-text-primary" />
        </button>
        {driver.photo ? (
          <img
            src={driver.photo}
            alt={driver.name ?? 'Driver'}
            className="w-9 h-9 rounded-xl object-cover flex-shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-[12px] font-bold"
            style={{ background: 'linear-gradient(135deg, #0A9FB0, #DC3E93)' }}
          >
            {driver.name ? getInitials(driver.name) : '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-tight truncate text-text-primary">{driver.name ?? 'Your driver'}</p>
          {driver.rating && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-amber-400 text-[11px]">★</span>
              <span className="text-[12px] font-medium text-text-secondary">{Number(driver.rating).toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 animate-spin border-border border-t-primary" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <p className="text-sm font-medium text-text-muted">No messages yet. Send a quick update below.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map(msg => (
              <Bubble key={msg.clientMsgId} msg={msg} onRetry={() => retry(msg)} />
            ))}
          </AnimatePresence>
        )}
        <div ref={listEndRef} />
      </div>

      {isClosed ? (
        <ReadOnlyBanner />
      ) : (
        <>
          {/* Canned replies */}
          <div className="flex gap-2 px-4 pb-2 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
            {CANNED_REPLIES.map(reply => (
              <button
                key={reply}
                onClick={() => void send(reply)}
                className="flex-shrink-0 px-3.5 py-2 rounded-full text-[12.5px] font-medium whitespace-nowrap active:scale-95 transition-transform bg-background border border-border text-text-secondary"
              >
                {reply}
              </button>
            ))}
          </div>

          {/* Input bar */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0 bg-surface border-t border-border"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a message"
              className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none bg-surface-2 border border-border text-text-primary"
            />
            <motion.button
              type="submit"
              disabled={!input.trim()}
              whileTap={{ scale: 0.9 }}
              aria-label="Send message"
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #0A9FB0 0%, #22B8C9 55%, #DC3E93 100%)' }}
            >
              <Send size={16} className="text-white" />
            </motion.button>
          </form>
        </>
      )}
    </div>
  )
}

function ReadOnlyBanner() {
  const prefersReducedMotion = useReducedMotion()
  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="flex items-center justify-center px-4 flex-shrink-0"
      style={{ paddingTop: '0.75rem', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <span
        className="px-4 py-2 rounded-full text-[12.5px] font-medium text-center"
        style={{ background: '#E0F2FE', color: '#0EA5E9' }}
      >
        This ride has ended · Chat is read-only
      </span>
    </motion.div>
  )
}

function Bubble({ msg, onRetry }: { msg: LocalMessage; onRetry: () => void }) {
  const mine = msg.senderType === 'user'
  const failed = msg.localStatus === 'failed'
  const prefersReducedMotion = useReducedMotion()

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
    >
      <div className="flex flex-col max-w-[78%]" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <div
          className={`px-3.5 py-2.5 text-sm leading-snug ${mine ? 'bg-primary text-white' : 'bg-surface-2 border border-border text-text-primary'}`}
          style={
            mine
              ? { borderRadius: '16px 16px 4px 16px', opacity: msg.localStatus === 'sending' ? 0.7 : 1 }
              : { borderRadius: '16px 16px 16px 4px' }
          }
        >
          {msg.body}
        </div>
        <div className="flex items-center gap-1 mt-1 px-1">
          <span className="text-[10.5px] font-medium text-text-muted">{fmtTime(msg.createdAt)}</span>
          {mine && !failed && (
            msg.localStatus === 'sending' ? (
              <span className="text-[10.5px] text-text-muted">Sending…</span>
            ) : msg.readAt ? (
              <CheckCheck size={12} className="text-accent" />
            ) : (
              <Check size={12} className="text-primary" />
            )
          )}
          {mine && failed && (
            <button onClick={onRetry} className="text-[10.5px] font-semibold text-status-error">
              Failed · Tap to retry
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
