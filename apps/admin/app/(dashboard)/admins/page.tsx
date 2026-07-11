'use client'

import { useEffect, useState } from 'react'
import { UserPlus, X, Send, Ban, ShieldOff, ShieldCheck } from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import StatusPill from '@/components/ui/StatusPill'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { adminInvitesApi, adminAccountsApi, type AdminInvite, type AdminAccount } from '@/lib/admin-invites-api'
import { useAdminAuth } from '@/lib/auth-context'
import type { AdminRole } from '@/lib/mock-data'

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  ops_admin: 'Ops Admin',
  support_admin: 'Support Admin',
  finance_admin: 'Finance Admin',
}

const ROLE_PILL: Record<AdminRole, string> = {
  super_admin: 'pill-purple',
  ops_admin: 'pill-info',
  support_admin: 'pill-muted',
  finance_admin: 'pill-success',
}

function RolePill({ role }: { role: AdminRole }) {
  return <span className={ROLE_PILL[role]}>{ROLE_LABEL[role]}</span>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AdminsPage() {
  const { admin: currentAdmin } = useAdminAuth()
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [invites, setInvites] = useState<AdminInvite[]>([])
  const [loadingAdmins, setLoadingAdmins] = useState(true)
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [inviting, setInviting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AdminRole>('ops_admin')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<AdminInvite | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminAccount | null>(null)

  const loadAdmins = async () => {
    setLoadingAdmins(true)
    try {
      setAdmins(await adminAccountsApi.list())
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 403) setForbidden(true)
    } finally {
      setLoadingAdmins(false)
    }
  }

  const loadInvites = async () => {
    setLoadingInvites(true)
    try {
      setInvites(await adminInvitesApi.list())
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 403) setForbidden(true)
    } finally {
      setLoadingInvites(false)
    }
  }

  useEffect(() => {
    void loadAdmins()
    void loadInvites()
  }, [])

  const openInvite = () => {
    setInviteEmail('')
    setInviteRole('ops_admin')
    setInviteError(null)
    setInviting(true)
  }

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError(null)

    if (!inviteEmail.trim()) {
      setInviteError('Enter an email address.')
      return
    }

    setSending(true)
    try {
      const invite = await adminInvitesApi.create({ email: inviteEmail.trim().toLowerCase(), role: inviteRole })
      setInvites(prev => [invite, ...prev])
      setInviting(false)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const body = (err as { response?: { data?: { error?: string } } })?.response?.data
      if (status === 409) {
        setInviteError('A pending invite already exists for this email.')
      } else if (body?.error) {
        setInviteError(body.error)
      } else {
        setInviteError('Could not send the invite. Please try again.')
      }
    } finally {
      setSending(false)
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    const revoked = await adminInvitesApi.revoke(revokeTarget.id)
    setInvites(prev => prev.map(i => (i.id === revoked.id ? revoked : i)))
  }

  const confirmStatusChange = async () => {
    if (!statusTarget) return
    const nextStatus = statusTarget.admin_status === 'active' ? 'suspended' : 'active'
    const updated = await adminAccountsApi.setStatus(statusTarget.id, nextStatus)
    setAdmins(prev => prev.map(a => (a.id === updated.id ? updated : a)))
  }

  const adminColumns = [
    { key: 'email', header: 'Email', render: (a: AdminAccount) => <span className="text-sm font-medium text-text-primary">{a.email}</span> },
    { key: 'role', header: 'Role', width: '160px', render: (a: AdminAccount) => <RolePill role={a.role} /> },
    { key: 'admin_status', header: 'Status', width: '120px', render: (a: AdminAccount) => <StatusPill status={a.admin_status} /> },
    { key: 'created_at', header: 'Joined', width: '140px', render: (a: AdminAccount) => <span className="text-xs text-text-muted">{formatDate(a.created_at)}</span> },
    {
      key: 'actions', header: '', width: '90px',
      render: (a: AdminAccount) => a.id === currentAdmin?.id ? null : (
        <button
          onClick={() => setStatusTarget(a)}
          className="text-text-muted hover:text-danger transition-colors p-1 rounded hover:bg-danger-light cursor-pointer"
          title={a.admin_status === 'active' ? 'Suspend admin' : 'Reactivate admin'}
        >
          {a.admin_status === 'active' ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
        </button>
      ),
    },
  ]

  const inviteColumns = [
    { key: 'email', header: 'Email', render: (i: AdminInvite) => <span className="text-sm font-medium text-text-primary">{i.email}</span> },
    { key: 'role', header: 'Role', width: '160px', render: (i: AdminInvite) => <RolePill role={i.role} /> },
    { key: 'status', header: 'Status', width: '110px', render: (i: AdminInvite) => <StatusPill status={i.status} /> },
    { key: 'expires_at', header: 'Expires', width: '140px', render: (i: AdminInvite) => <span className="text-xs text-text-muted">{formatDate(i.expires_at)}</span> },
    {
      key: 'actions', header: '', width: '90px',
      render: (i: AdminInvite) => i.status === 'pending' ? (
        <button
          onClick={() => setRevokeTarget(i)}
          className="text-text-muted hover:text-danger transition-colors p-1 rounded hover:bg-danger-light cursor-pointer"
          title="Revoke invite"
        >
          <X size={14} />
        </button>
      ) : null,
    },
  ]

  if (forbidden) {
    return (
      <div className="admin-card p-10 flex flex-col items-center text-center max-w-md mx-auto mt-12">
        <div className="w-12 h-12 rounded-2xl bg-danger-light flex items-center justify-center mb-4">
          <Ban size={20} className="text-danger" />
        </div>
        <h2 className="text-base font-semibold text-text-primary mb-1.5">Access restricted</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Managing admin accounts is limited to super admins. Contact a super admin if you need access.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          onClick={openInvite}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity cursor-pointer"
        >
          <UserPlus size={15} />
          Invite Admin
        </button>
      </div>

      <div className="admin-card">
        <div className="px-5 py-4 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Admin Accounts</h3>
        </div>
        <DataTable
          isLoading={loadingAdmins}
          emptyMessage="No admin accounts yet"
          data={admins as unknown as Record<string, unknown>[]}
          columns={adminColumns as unknown as { key: string; header: string; width?: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
        />
      </div>

      <div className="admin-card">
        <div className="px-5 py-4 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Invites</h3>
        </div>
        <DataTable
          isLoading={loadingInvites}
          emptyMessage="No invites sent yet"
          data={invites as unknown as Record<string, unknown>[]}
          columns={inviteColumns as unknown as { key: string; header: string; width?: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
        />
      </div>

      <SlideOver isOpen={inviting} onClose={() => setInviting(false)} title="Invite Admin">
        <form onSubmit={e => void submitInvite(e)} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Email address</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="name@ocar.com"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Role</label>
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as AdminRole)}
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors bg-surface"
            >
              {(Object.keys(ROLE_LABEL) as AdminRole[]).map(role => (
                <option key={role} value={role}>{ROLE_LABEL[role]}</option>
              ))}
            </select>
          </div>

          {inviteError && (
            <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl">
              {inviteError}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInviting(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Send size={14} />
              {sending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </SlideOver>

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={open => { if (!open) setRevokeTarget(null) }}
        title="Revoke this invite?"
        description={`${revokeTarget?.email ?? ''} will no longer be able to use this invite link to join.`}
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={() => void confirmRevoke()}
      />

      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={open => { if (!open) setStatusTarget(null) }}
        title={statusTarget?.admin_status === 'active' ? 'Suspend this admin?' : 'Reactivate this admin?'}
        description={
          statusTarget?.admin_status === 'active'
            ? `${statusTarget?.email ?? ''} will be signed out and unable to log in until reactivated.`
            : `${statusTarget?.email ?? ''} will be able to log in again.`
        }
        confirmLabel={statusTarget?.admin_status === 'active' ? 'Suspend' : 'Reactivate'}
        variant={statusTarget?.admin_status === 'active' ? 'danger' : 'success'}
        onConfirm={() => void confirmStatusChange()}
      />
    </div>
  )
}
