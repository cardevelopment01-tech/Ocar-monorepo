'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

export default function RideChatPage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router = useRouter()

  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const listEndRef = useRef<HTMLDivElement>(null)
  const lastSeenIdRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)

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

    let mounted = true
    mountedRef.current = true
    rideApi.getMessages(rideId).then(history => {
      if (!mounted) return
      setMessages(history.map(m => ({ ...m, localStatus: 'sent' })))
      if (history.length) lastSeenIdRef.current = history[history.length - 1]!.id
      void rideApi.markChatRead(rideId).catch(() => {})
    }).catch(() => {}).finally(() => setLoading(false))

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

    return () => {
      mounted = false
      mountedRef.current = false
      socket.off('chat:message', onChatMessage)
      socket.off('chat:read', onChatRead)
      socket.off('connect', onReconnect)
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
    <div className="h-[100dvh] flex flex-col" style={{ background: '#FAFBFF' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #E8EEFF', background: '#FFFFFF' }}>
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
          style={{ background: '#F5F7FF' }}
        >
          <ChevronLeft size={18} style={{ color: '#0F172A' }} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-tight" style={{ color: '#0F172A' }}>Chat with driver</p>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: '#E8EEFF', borderTopColor: '#0A9FB0' }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <p className="text-sm font-medium" style={{ color: '#94A3B8' }}>No messages yet. Send a quick update below.</p>
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

      {/* Canned replies */}
      <div className="flex gap-2 px-4 pb-2 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
        {CANNED_REPLIES.map(reply => (
          <button
            key={reply}
            onClick={() => void send(reply)}
            className="flex-shrink-0 px-3.5 py-2 rounded-full text-[12.5px] font-medium whitespace-nowrap active:scale-95 transition-transform"
            style={{ background: '#F5F7FF', border: '1px solid #E8EEFF', color: '#475569' }}
          >
            {reply}
          </button>
        ))}
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid #E8EEFF', background: '#FFFFFF', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message"
          className="flex-1 rounded-full px-4 py-2.5 text-sm outline-none"
          style={{ background: '#F5F7FF', border: '1px solid #E8EEFF', color: '#0F172A' }}
        />
        <motion.button
          type="submit"
          disabled={!input.trim()}
          whileTap={{ scale: 0.9 }}
          aria-label="Send message"
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          style={{ background: '#0A9FB0' }}
        >
          <Send size={16} style={{ color: '#FFFFFF' }} />
        </motion.button>
      </form>
    </div>
  )
}

function Bubble({ msg, onRetry }: { msg: LocalMessage; onRetry: () => void }) {
  const mine = msg.senderType === 'user'
  const failed = msg.localStatus === 'failed'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
    >
      <div className="flex flex-col max-w-[78%]" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
        <div
          className="px-3.5 py-2.5 text-sm leading-snug"
          style={
            mine
              ? { background: '#0A9FB0', color: '#FFFFFF', borderRadius: '16px 16px 4px 16px', opacity: msg.localStatus === 'sending' ? 0.7 : 1 }
              : { background: '#F5F7FF', border: '1px solid #E8EEFF', color: '#0F172A', borderRadius: '16px 16px 16px 4px' }
          }
        >
          {msg.body}
        </div>
        <div className="flex items-center gap-1 mt-1 px-1">
          <span className="text-[10.5px] font-medium" style={{ color: '#94A3B8' }}>{fmtTime(msg.createdAt)}</span>
          {mine && !failed && (
            msg.localStatus === 'sending' ? (
              <span className="text-[10.5px]" style={{ color: '#94A3B8' }}>Sending…</span>
            ) : msg.readAt ? (
              <CheckCheck size={12} style={{ color: '#0A9FB0' }} />
            ) : (
              <Check size={12} style={{ color: '#94A3B8' }} />
            )
          )}
          {mine && failed && (
            <button onClick={onRetry} className="text-[10.5px] font-semibold" style={{ color: '#DC2626' }}>
              Failed · Tap to retry
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
