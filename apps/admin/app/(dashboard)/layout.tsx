'use client'
import { usePathname } from 'next/navigation'
import AdminSidebar from '@/components/layout/AdminSidebar'
import AdminTopBar from '@/components/layout/AdminTopBar'
import { useAdminAuth } from '@/lib/auth-context'
import { mockSOS } from '@/lib/mock-data'
import type { AdminRole } from '@/lib/mock-data'

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/overview':              { title: 'Dashboard',     subtitle: 'Platform health at a glance' },
  '/live-map':              { title: 'Live Map',       subtitle: 'Real-time driver & ride tracking' },
  '/rides':                 { title: 'Rides',          subtitle: 'All ride activity' },
  '/drivers':               { title: 'Drivers',        subtitle: 'Driver management & approvals' },
  '/users':                 { title: 'Users',          subtitle: 'Rider accounts' },
  '/disputes':              { title: 'Disputes',       subtitle: 'Unresolved issues requiring action' },
  '/sos':                   { title: 'SOS Alerts',     subtitle: 'Emergency response' },
  '/payments':              { title: 'Payments',       subtitle: 'Transaction overview' },
  '/settlements':           { title: 'Settlements',    subtitle: 'Driver payout management' },
  '/refunds':               { title: 'Refunds',        subtitle: 'Refund processing' },
  '/config/rate-cards':     { title: 'Rate Cards',     subtitle: 'Fare configuration' },
  '/config/system-config':  { title: 'System Config',  subtitle: 'Platform configuration keys' },
  '/config/feature-flags':  { title: 'Feature Flags',  subtitle: 'Toggle platform features' },
  '/analytics':             { title: 'Reports',        subtitle: 'Analytics and exports' },
}

function getInitials(name?: string | null) {
  if (!name) return 'A'
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const { admin, logout } = useAdminAuth()
  const meta = PAGE_META[path] ?? { title: 'Admin', subtitle: '' }
  const sosActive = mockSOS.some(s => s.status === 'active')

  const adminName = admin?.email?.split('@')[0] ?? 'Admin'
  const adminInitials = getInitials(adminName)
  const role = (admin?.role ?? 'super_admin') as AdminRole

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar
        role={role}
        adminName={adminName}
        adminInitials={adminInitials}
        sosActive={sosActive}
        onLogout={logout}
      />
      <div className="flex-1 ml-[240px] flex flex-col h-full overflow-hidden">
        <AdminTopBar
          title={meta.title}
          subtitle={meta.subtitle}
          adminName={adminName}
          adminInitials={adminInitials}
          notificationCount={mockSOS.filter(s => s.status === 'active').length}
        />
        <main className="flex-1 overflow-y-auto bg-canvas">
          <div className="p-6 animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  )
}
