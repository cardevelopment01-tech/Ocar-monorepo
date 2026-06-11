import { useLocation, useNavigate } from 'react-router-dom'
import { Map, TrendingUp, Wallet, User } from 'lucide-react'

const TABS = [
  { path: '/',         Icon: Map,        label: 'Home'     },
  { path: '/earnings', Icon: TrendingUp,  label: 'Earnings' },
  { path: '/wallet',   Icon: Wallet,      label: 'Wallet'   },
  { path: '/profile',  Icon: User,        label: 'Profile'  },
] as const

const MAIN = new Set(['/', '/earnings', '/wallet', '/profile'])

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  if (!MAIN.has(pathname)) return null

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex items-stretch"
      style={{
        height: 68,
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.07)',
        zIndex: 100,
      }}
      aria-label="Main navigation"
    >
      {TABS.map(({ path, Icon, label }) => {
        const active = pathname === path
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex-1 relative flex flex-col items-center justify-center gap-[3px] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:bg-primary/5"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-primary" />
            )}
            <Icon
              size={22}
              strokeWidth={active ? 2.5 : 1.75}
              className={active ? 'text-primary' : 'text-text-muted'}
            />
            <span className={`text-[11px] font-semibold ${active ? 'text-primary' : 'text-text-muted'}`}>
              {label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
