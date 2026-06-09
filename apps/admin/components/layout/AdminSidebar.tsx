'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Map, Car, Truck, Users, User, AlertTriangle, Shield,
  CreditCard, Wallet, RotateCcw, Tag, Settings, ToggleLeft,
  BarChart2, Camera, LogOut, MapPin,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdminRole } from '@/lib/mock-data'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  badge?: React.ReactNode
  roles: AdminRole[]
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/overview',   label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin','ops_admin','finance_admin','support_admin'] },
      { href: '/live-map',   label: 'Live Map',  icon: Map,             roles: ['super_admin','ops_admin'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/rides',     label: 'Rides',     icon: Car,           roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/drivers',   label: 'Drivers',   icon: Users,         roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/vehicles',  label: 'Vehicles',  icon: Truck,         roles: ['super_admin','ops_admin'] },
      { href: '/users',     label: 'Users',     icon: User,          roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/disputes',  label: 'Disputes',  icon: AlertTriangle, roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/sos',       label: 'SOS Alerts',icon: Shield,        roles: ['super_admin','ops_admin'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/payments',           label: 'Payments',    icon: CreditCard, roles: ['super_admin','finance_admin'] },
      { href: '/settlements',        label: 'Settlements', icon: Wallet,     roles: ['super_admin','finance_admin'] },
      { href: '/refunds',            label: 'Refunds',     icon: RotateCcw,  roles: ['super_admin','finance_admin'] },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/cities',               label: 'Cities',        icon: MapPin,      roles: ['super_admin', 'ops_admin'] },
      { href: '/config/rate-cards',    label: 'Rate Cards',    icon: Tag,         roles: ['super_admin'] },
      { href: '/config/system-config', label: 'System Config', icon: Settings,    roles: ['super_admin'] },
      { href: '/config/feature-flags', label: 'Feature Flags', icon: ToggleLeft,  roles: ['super_admin'] },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/analytics',  label: 'Reports',   icon: BarChart2, roles: ['super_admin','finance_admin'] },
      { href: '/snapshots',  label: 'Snapshots', icon: Camera,    roles: ['super_admin','finance_admin'] },
    ],
  },
]

interface AdminSidebarProps {
  role: AdminRole
  adminName: string
  adminInitials: string
  sosActive?: boolean
  onLogout?: () => void
}

export default function AdminSidebar({ role, adminName, adminInitials, sosActive = false, onLogout }: AdminSidebarProps) {
  const path = usePathname()

  return (
    <aside
      className="fixed top-0 left-0 h-full w-[240px] bg-sidebar flex flex-col z-40"
      style={{ boxShadow: '2px 0 8px rgba(15,23,42,0.15)', borderRight: '1px solid #1E293B' }}
    >
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-black text-base">O</span>
          </div>
          <span className="text-white font-black text-xl">car</span>
        </div>
        <p className="text-sidebar-text text-xs uppercase tracking-widest pl-0.5">Admin Panel</p>
      </div>

      <div className="mx-4 border-b border-sidebar-border mb-3" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-4 pb-4">
        {NAV.map(group => {
          const visible = group.items.filter(i => i.roles.includes(role))
          if (!visible.length) return null
          return (
            <div key={group.label}>
              <p className="text-sidebar-text/50 text-xs uppercase tracking-widest px-3 mb-1">
                {group.label}
              </p>
              {visible.map(item => {
                const active = path === item.href || (item.href !== '/overview' && path.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn('nav-item', active && 'active')}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-white rounded-r-full" />
                    )}
                    <item.icon size={16} />
                    <span className="flex-1">{item.label}</span>
                    {item.label === 'SOS Alerts' && sosActive && (
                      <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Bottom profile */}
      <div className="border-t border-sidebar-border mx-4 pt-4 pb-5">
        <div className="flex items-center gap-3 px-2">
          <div className="w-8 h-8 rounded-full bg-primary-dark flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{adminInitials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{adminName}</p>
            <p className="text-sidebar-text text-xs truncate capitalize">{role.replace('_', ' ')}</p>
          </div>
          <button onClick={onLogout} className="text-sidebar-text hover:text-white transition-colors" title="Logout">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
