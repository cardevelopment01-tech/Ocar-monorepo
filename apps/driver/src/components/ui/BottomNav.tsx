import { useLocation, useNavigate } from 'react-router-dom'
import { Map, TrendingUp, Wallet, User } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
const TABS = [
  { path: '/',         Icon: Map,        label: 'Home'     },
  { path: '/earnings', Icon: TrendingUp,  label: 'Earnings' },
  { path: '/wallet',   Icon: Wallet,      label: 'Wallet'   },
  { path: '/profile',  Icon: User,        label: 'Profile'  },
]

const MAIN = new Set(TABS.map(t => t.path))

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()

  if (!MAIN.has(pathname)) return null

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex items-stretch"
      style={{
        height: 60,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(79,70,229,0.08)',
        boxShadow: '0 -4px 24px rgba(79,70,229,0.08)',
        zIndex: 100,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label="Main navigation"
    >
      {TABS.map(({ path, Icon, label }) => {
        const active = pathname === path
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex-1 relative flex flex-col items-center justify-center gap-[3px] cursor-pointer focus-visible:outline-none"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            {active && !prefersReducedMotion && (
              <motion.div
                layoutId="nav-pill"
                className="absolute inset-1 rounded-full"
                style={{ background: 'rgba(79,70,229,0.08)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            {active && prefersReducedMotion && (
              <div className="absolute inset-1 rounded-full" style={{ background: 'rgba(79,70,229,0.08)' }} />
            )}
            <Icon
              size={20}
              strokeWidth={active ? 2.2 : 1.75}
              className={`relative z-10 transition-colors duration-150 ${active ? 'text-primary' : 'text-text-muted'}`}
            />
            <span className={`relative z-10 text-[10px] font-semibold transition-colors duration-150 ${active ? 'text-primary' : 'text-text-muted'}`}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
