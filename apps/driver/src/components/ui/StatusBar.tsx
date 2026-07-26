import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, AlertTriangle } from 'lucide-react'
import { motion, useReducedMotion, useMotionValue, useTransform, animate } from 'framer-motion'
import OcarLogoMark from '@/components/ui/OcarLogoMark'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import api from '@/lib/api'
import { GLASS } from '@/lib/constants'

const MIN_WALLET_BALANCE = 500

// One header, two skins. `solid` = flat fixed bar on content pages (Earnings/
// Wallet/Profile). `floating` = transparent region with opaque chips over the
// Home map. Everything except the surface is identical — same 56px rhythm,
// same StatusPill, same bell, same left→right order (logo · [earnings] ·
// pill · bell). See docs/DRIVER_NAV_REDESIGN_PLAN.md.
type Surface = 'solid' | 'floating'

interface StatusBarProps {
  isOnline: boolean
  earningsToday: number
  tripsToday?: number
  surface?: Surface
}

// Today's earnings — Home's top-left anchor (floating skin). Full rupees with
// Indian grouping, never abbreviated: drivers reconcile this against cash and
// per-trip fares, so ₹1.2k would destroy trust. The number is the compulsion;
// it earns a spot in the chrome. Reference: Robinhood's header ticker minus the
// colour drama (earnings only go one way). See plan §9.
const inr = (n: number) => Math.round(n).toLocaleString('en-IN')

function EarningsChip({ amount, trips }: { amount: number; trips: number }) {
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()
  const mv = useMotionValue(amount)
  const display = useTransform(mv, v => inr(v))
  const prev = useRef(amount)
  const [wash, setWash] = useState(0)

  // Count-up only on a real increase. mv seeds to the (persisted) current value,
  // so a cold mount where fetched === cached produces no motion — the roll fires
  // only when today's total actually grew (a completed trip). Never rolls from ₹0.
  useEffect(() => {
    const increased = amount > prev.current
    prev.current = amount
    if (prefersReducedMotion) { mv.set(amount); return }
    const controls = animate(mv, amount, { duration: 0.5, ease: [0.16, 1, 0.3, 1] })
    if (increased) setWash(k => k + 1)
    return () => controls.stop()
  }, [amount]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      onClick={() => navigate('/earnings')}
      aria-label={`Today's earnings ₹${inr(amount)}${trips > 0 ? `, ${trips} trips` : ''}. View earnings`}
      className="relative flex items-center gap-1.5 rounded-2xl cursor-pointer active:scale-[0.97] transition-transform overflow-hidden"
      style={{ minHeight: 44, padding: '0 14px', ...GLASS }}
    >
      {/* one-shot green acknowledgment wash on increase */}
      {wash > 0 && !prefersReducedMotion && (
        <motion.span
          key={wash}
          aria-hidden
          className="absolute inset-0"
          style={{ background: '#059669' }}
          initial={{ opacity: 0.1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      )}
      <span className="relative flex items-baseline gap-1 leading-none">
        <span className="text-[15px] font-bold" style={{ color: '#047857' }}>₹</span>
        <motion.span className="text-[15px] font-bold tabular-nums" style={{ color: '#0F172A' }}>{display}</motion.span>
        {trips > 0 && (
          <span className="text-[11px] font-medium tabular-nums ml-1" style={{ color: '#475569' }}>· {trips} trip{trips === 1 ? '' : 's'}</span>
        )}
      </span>
    </button>
  )
}

// Ember status pill — the emotional anchor (§8 of the plan). Online is a deep
// warm ember lit from within (bright top sheen → burnt base), NOT flat hi-vis
// orange. Offline is cold dead slate. The premium lives in the contrast; the
// only motion is on the transition (no looping breathe — fatigue on an all-day
// screen). White text rides the deep lower band so it passes AA contrast; the
// bright sheen up top is only the lit edge.
const EMBER_FILL =
  'linear-gradient(180deg, #FB923C 0%, #EA580C 22%, #C2410C 60%, #9A3412 100%)'
const EMBER_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 10px -1px rgba(234,88,12,0.42), 0 1px 3px rgba(154,52,18,0.35)'
const OFFLINE_SHADOW = '0 1px 2px rgba(15,23,42,0.15)'
const EMBER_TRANSITION = 'opacity 300ms cubic-bezier(0.2,0,0,1)'

function StatusPill({ isOnline }: { isOnline: boolean }) {
  const prefersReducedMotion = useReducedMotion()
  const [pulseKey, setPulseKey] = useState(0)
  const prevOnline = useRef(isOnline)

  // Fire the dot ring pulse once, only on the offline→online transition — never
  // on mount or navigation (prevOnline seeds to the current value).
  useEffect(() => {
    if (isOnline && !prevOnline.current) setPulseKey(k => k + 1)
    prevOnline.current = isOnline
  }, [isOnline])

  return (
    <div
      className="relative flex items-center gap-1.5 rounded-full"
      style={{
        padding: '5px 12px',
        boxShadow: isOnline ? EMBER_SHADOW : OFFLINE_SHADOW,
        transition: 'box-shadow 300ms cubic-bezier(0.2,0,0,1)',
      }}
      role="status"
      aria-label={isOnline ? 'You are online' : 'You are offline'}
    >
      {/* Cross-faded fill layers — gradients don't tween, opacity does. Rounded
          on the layers themselves (not clipped by the parent) so the dot's halo
          pulse can extend past the pill edge. */}
      <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: EMBER_FILL, opacity: isOnline ? 1 : 0, transition: EMBER_TRANSITION }} />
      <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: '#1E293B', opacity: isOnline ? 0 : 1, transition: EMBER_TRANSITION }} />

      {/* Live dot with one-shot halo pulse on going online */}
      <span className="relative flex items-center justify-center" style={{ width: 6, height: 6 }}>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: isOnline ? '#FFFFFF' : '#64748B',
            boxShadow: isOnline ? '0 0 0 3px rgba(255,255,255,0.28)' : 'none',
            transition: 'background 300ms cubic-bezier(0.2,0,0,1)',
          }}
        />
        {pulseKey > 0 && isOnline && !prefersReducedMotion && (
          <motion.span
            key={pulseKey}
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: '0 0 0 1.5px rgba(255,255,255,0.55)' }}
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: 2.6, opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </span>

      <span
        className="relative text-[12px] font-bold tracking-[0.02em]"
        style={{
          color: isOnline ? '#FFFFFF' : '#CBD5E1',
          textShadow: isOnline ? '0 1px 1px rgba(124,45,18,0.45)' : 'none',
        }}
      >
        {isOnline ? 'Online' : 'Offline'}
      </span>
    </div>
  )
}

function NotificationBell({ surface }: { surface: Surface }) {
  const { unreadCount, openSheet } = useNotificationsStore()
  const prefersReducedMotion = useReducedMotion()
  const chip = surface === 'floating'
    ? GLASS
    : { background: 'rgba(79,70,229,0.05)', border: '1px solid rgba(79,70,229,0.08)' }

  return (
    <button
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      onClick={openSheet}
      className="relative rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-90"
      style={{ width: 44, height: 44, ...chip }}
    >
      <Bell size={20} className="text-text-secondary" strokeWidth={1.8} />
      {unreadCount > 0 && (
        <motion.span
          key={unreadCount}
          className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500"
          style={{ boxShadow: '0 0 0 1.5px #FFFFFF' }}
          initial={prefersReducedMotion ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 14 }}
          aria-hidden
        />
      )}
    </button>
  )
}

export default function StatusBar({ isOnline, earningsToday, tripsToday = 0, surface = 'solid' }: StatusBarProps) {
  const navigate = useNavigate()
  const [walletWarning, setWalletWarning] = useState<'low' | 'frozen' | null>(null)

  useEffect(() => {
    api.get<{ balance: string; is_frozen: boolean }>('/api/v1/payments/wallet/driver')
      .then(res => {
        if (res.data.is_frozen) setWalletWarning('frozen')
        else if (parseFloat(res.data.balance) < MIN_WALLET_BALANCE) setWalletWarning('low')
        else setWalletWarning(null)
      })
      .catch(() => {})
  }, [])

  const floating = surface === 'floating'

  const containerClass = floating
    ? 'absolute top-0 left-0 right-0 flex items-center justify-between px-4 pb-2'
    : 'fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5'

  const containerStyle = floating
    ? { zIndex: 10, paddingTop: 'max(calc(env(safe-area-inset-top) + 12px), 48px)' }
    : {
        height: 56,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(79,70,229,0.08)',
        boxShadow: '0 1px 12px rgba(79,70,229,0.07)',
      }

  return (
    <div className={containerClass} style={containerStyle}>
      {/* Left anchor. Solid pages lead with the logo (brand identity). Home's
          floating skin leads with today's earnings instead — the one screen
          where the driver's money outranks the logo (the logo still lives on
          the other three tabs). Reversible: swap EarningsChip back for the logo
          chip to restore brand-on-Home. See plan §9. */}
      {floating ? (
        <EarningsChip amount={earningsToday} trips={tripsToday} />
      ) : (
        <OcarLogoMark size="md" variant="color" />
      )}

      <div className="flex items-center gap-2.5">
        {/* Earnings glance + wallet warning: solid skin only (Home has no
            today-earnings data plumbed yet — see plan §2 note). */}
        {!floating && isOnline && earningsToday > 0 && (
          <span className="text-sm font-bold tabular-nums text-accent-green">
            ₹{earningsToday.toLocaleString('en-IN')}
          </span>
        )}

        {!floating && walletWarning && (
          <button
            onClick={() => navigate('/wallet')}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 cursor-pointer"
            style={walletWarning === 'frozen' ? {
              background: 'rgba(239,68,68,0.08)',
              border:     '1px solid rgba(239,68,68,0.20)',
            } : {
              background: 'rgba(217,119,6,0.08)',
              border:     '1px solid rgba(217,119,6,0.20)',
            }}
          >
            <AlertTriangle
              size={12}
              className={walletWarning === 'frozen' ? 'text-accent-red' : 'text-accent-amber'}
              aria-hidden="true"
            />
            <span className={`text-[10px] font-bold ${walletWarning === 'frozen' ? 'text-accent-red' : 'text-accent-amber'}`}>
              {walletWarning === 'frozen' ? 'Frozen' : 'Low balance'}
            </span>
          </button>
        )}

        <StatusPill isOnline={isOnline} />
        <NotificationBell surface={surface} />
      </div>
    </div>
  )
}
