'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DEMO_MODE } from '@/lib/demo'
import {
  LayoutDashboard, Map, Car, Truck, Users, User, AlertTriangle, Shield,
  CreditCard, Wallet, RotateCcw, Tag, Settings, ToggleLeft,
  BarChart2, Camera, LogOut, MapPin, MessageSquare, UserCog, ScrollText, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdminRole } from '@/lib/mock-data'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  badge?: React.ReactNode
  roles: AdminRole[]
  demo?: true
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/overview', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin','ops_admin','finance_admin','support_admin'] },
      { href: '/live-map', label: 'Live Map',  icon: Map,             roles: ['super_admin','ops_admin'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/rides',    label: 'Rides',      icon: Car,           roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/drivers',  label: 'Drivers',    icon: Users,         roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/vehicles', label: 'Vehicles',   icon: Truck,         roles: ['super_admin','ops_admin'] },
      { href: '/users',    label: 'Users',      icon: User,          roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/disputes', label: 'Disputes',   icon: AlertTriangle, roles: ['super_admin','ops_admin','support_admin'] },
      { href: '/sos',      label: 'SOS Alerts', icon: Shield,        roles: ['super_admin','ops_admin'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/payments',    label: 'Payments',    icon: CreditCard, roles: ['super_admin','finance_admin'] },
      { href: '/payouts',     label: 'Payouts',     icon: Wallet,     roles: ['super_admin','finance_admin'] },
      { href: '/settlements', label: 'Settlements', icon: Wallet,     roles: ['super_admin','finance_admin'], demo: true },
      { href: '/refunds',     label: 'Refunds',     icon: RotateCcw,  roles: ['super_admin','finance_admin'], demo: true },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/cities',               label: 'Cities',        icon: MapPin,     roles: ['super_admin','ops_admin'] },
      { href: '/config/rate-cards',    label: 'Rate Cards',    icon: Tag,        roles: ['super_admin'] },
      { href: '/config/system-config', label: 'System Config', icon: Settings,   roles: ['super_admin'], demo: true },
      { href: '/config/feature-flags', label: 'Feature Flags', icon: ToggleLeft, roles: ['super_admin'], demo: true },
      { href: '/config/notification-templates', label: 'Notification Templates', icon: MessageSquare, roles: ['super_admin'] },
      { href: '/admins', label: 'Admins', icon: UserCog, roles: ['super_admin'] },
      { href: '/audit-log', label: 'Audit Log', icon: ScrollText, roles: ['super_admin'] },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/analytics', label: 'Reports',   icon: BarChart2, roles: ['super_admin','finance_admin'] },
      { href: '/snapshots', label: 'Snapshots', icon: Camera,    roles: ['super_admin','finance_admin'], demo: true },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/security', label: 'Security', icon: ShieldCheck, roles: ['super_admin','ops_admin','finance_admin','support_admin'] },
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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  return (
    <aside
      className="fixed top-0 left-0 h-full w-[240px] bg-sidebar flex flex-col z-40"
      style={{ boxShadow: '1px 0 0 #E8EAFF' }}
    >
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm tracking-tight">O</span>
          </div>
          <div>
            <span className="text-text-primary font-black text-lg leading-none">car</span>
            <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-primary-light text-primary">
              Admin
            </span>
          </div>
        </div>
      </div>

      <div className="mx-4 border-b border-sidebar-border mb-2" />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-4 pb-4">
        {NAV.map(group => {
          const visible = group.items.filter(i => i.roles.includes(role) && !(DEMO_MODE && i.demo))
          if (!visible.length) return null
          return (
            <div key={group.label}>
              <p className="text-[11px] font-semibold text-text-muted px-3 mb-1.5">
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
                    <item.icon size={15} className={active ? 'text-white' : 'text-text-muted'} />
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
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{adminInitials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-primary text-xs font-semibold truncate">{adminName}</p>
            <p className="text-text-muted text-xs truncate capitalize">{role.replace('_', ' ')}</p>
          </div>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="text-text-muted hover:text-danger transition-colors cursor-pointer"
            title="Logout"
            aria-label="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        title="Log out?"
        description="You will be signed out of the admin panel."
        confirmLabel="Log Out"
        variant="warning"
        onConfirm={() => onLogout?.()}
      />
    </aside>
  )
}
