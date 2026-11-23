'use client'

import { useEffect, useState } from 'react'
import { UserPlus, X, Send, Ban, ShieldOff, ShieldCheck, RotateCw, AlertCircle, RefreshCw } from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import StatusPill from '@/components/ui/StatusPill'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SuccessToast from '@/components/ui/SuccessToast'
import { adminInvitesApi, adminAccountsApi, type AdminInvite, type AdminAccount } from '@/lib/admin-invites-api'
import { useAdminAuth } from '@/lib/auth-context'
import { extractErrorMessage } from '@/lib/http-errors'
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

const ICON_BUTTON = 'text-text-muted hover:text-danger transition-colors p-1 rounded hover:bg-danger-light cursor-pointer'

// Shown instead of a table when a list could not be loaded: an empty table would say "No admin accounts yet", which is a lie.
function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="m-5 flex items-center gap-3 rounded-xl bg-danger-light px-4 py-3 text-sm text-danger">
      <AlertCircle size={16} className="flex-shrink-0" />
      <span className="flex-1 font-medium">Could not load {what}.</span>
      <button onClick={onRetry} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold hover:bg-white/60 transition-colors cursor-pointer">
        <RefreshCw size={12} /> Try again
      </button>
    </div>
  )
}

export default function AdminsPage() {
  const { admin: currentAdmin } = useAdminAuth()
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [invites, setInvites] = useState<AdminInvite[]>([])
  const [loadingAdmins, setLoadingAdmins] = useState(true)
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [adminsFailed, setAdminsFailed] = useState(false)
  const [invitesFailed, setInvitesFailed] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  const [inviting, setInviting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AdminRole>('ops_admin')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<AdminInvite | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminAccount | null>(null)

  const [toast, setToast] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadAdmins = async () => {
    setLoadingAdmins(true)
    setAdminsFailed(false)
    try {
      setAdmins(await adminAccountsApi.list())
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 403) setForbidden(true)
      else setAdminsFailed(true)
    } finally {
      setLoadingAdmins(false)
    }
  }

  const loadInvites = async () => {
    setLoadingInvites(true)
    setInvitesFailed(false)
    try {
      setInvites(await adminInvitesApi.list())
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 403) setForbidden(true)
      else setInvitesFailed(true)
    } finally {
      setLoadingInvites(false)
    }
  }

  useEffect(() => {
    void loadAdmins()
    void loadInvites()
  }, [])

  // Opening from an expired or revoked invite pre-fills the same person and role: "invite again" is one click.
  const openInvite = (email = '', role: AdminRole = 'ops_admin') => {
    setInviteEmail(email)
    setInviteRole(role)
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
      // A re-invite leaves the old expired row in the list too; the new one goes on top.
      setInvites(prev => [invite, ...prev])
      setInviting(false)
      setToast(`Invite sent to ${invite.email}`)
    } catch (err: unknown) {
      // The server's messages are written for admins ("An admin account with this email already exists", ...): show them as they are.
      setInviteError(extractErrorMessage(err, 'Could not send the invite. Please try again.'))
    } finally {
      setSending(false)
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setActionError(null)
    try {
      const revoked = await adminInvitesApi.revoke(revokeTarget.id)
      setInvites(prev => prev.map(i => (i.id === revoked.id ? revoked : i)))
      setToast('Invite revoked')
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err, 'Could not revoke the invite. Please try again.'))
    }
  }

  const confirmStatusChange = async () => {
    if (!statusTarget) return
    setActionError(null)
    const nextStatus = statusTarget.admin_status === 'active' ? 'suspended' : 'active'
    try {
      const updated = await adminAccountsApi.setStatus(statusTarget.id, nextStatus)
      setAdmins(prev => prev.map(a => (a.id === updated.id ? updated : a)))
      setToast(nextStatus === 'suspended' ? `${updated.email} suspended` : `${updated.email} reactivated`)
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err, `Could not ${nextStatus === 'suspended' ? 'suspend' : 'reactivate'} this admin. Please try again.`))
    }
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
          className={ICON_BUTTON}
          title={a.admin_status === 'active' ? 'Suspend admin' : 'Reactivate admin'}
          aria-label={`${a.admin_status === 'active' ? 'Suspend' : 'Reactivate'} ${a.email}`}
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
          className={ICON_BUTTON}
          title="Revoke invite"
          aria-label={`Revoke the invite for ${i.email}`}
        >
          <X size={14} />
        </button>
      ) : i.status === 'expired' || i.status === 'revoked' ? (
        <button
          onClick={() => openInvite(i.email, i.role)}
          className="text-text-muted hover:text-primary transition-colors p-1 rounded hover:bg-surface-2 cursor-pointer"
          title="Invite again"
          aria-label={`Invite ${i.email} again`}
        >
          <RotateCw size={14} />
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
          onClick={() => openInvite()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity cursor-pointer"
        >
          <UserPlus size={15} />
          Invite Admin
        </button>
      </div>

      {actionError && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-danger-light px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1 font-medium">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss this message" className="rounded p-0.5 hover:bg-white/60 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="admin-card">
        <div className="px-5 py-4 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Admin Accounts</h3>
        </div>
        {adminsFailed ? (
          <LoadError what="admin accounts" onRetry={() => void loadAdmins()} />
        ) : (
          <DataTable
            isLoading={loadingAdmins}
            emptyMessage="No admin accounts yet"
            data={admins as unknown as Record<string, unknown>[]}
            columns={adminColumns as unknown as { key: string; header: string; width?: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          />
        )}
      </div>

      <div className="admin-card">
        <div className="px-5 py-4 border-b border-border-light">
          <h3 className="text-sm font-semibold text-text-primary">Invites</h3>
        </div>
        {invitesFailed ? (
          <LoadError what="invites" onRetry={() => void loadInvites()} />
        ) : (
          <DataTable
            isLoading={loadingInvites}
            emptyMessage="No invites sent yet"
            data={invites as unknown as Record<string, unknown>[]}
            columns={inviteColumns as unknown as { key: string; header: string; width?: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          />
        )}
      </div>

      <SlideOver isOpen={inviting} onClose={() => setInviting(false)} title="Invite Admin">
        <form onSubmit={e => void submitInvite(e)} className="p-6 space-y-5">
          <div>
            <label htmlFor="invite-email" className="block text-xs font-semibold text-text-secondary mb-1.5">Email address</label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="name@ocar.com"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="invite-role" className="block text-xs font-semibold text-text-secondary mb-1.5">Role</label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as AdminRole)}
              className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors bg-surface"
            >
              {(Object.keys(ROLE_LABEL) as AdminRole[]).map(role => (
                <option key={role} value={role}>{ROLE_LABEL[role]}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-text-muted">The invite link works for 48 hours and can be used once.</p>
          </div>

          {inviteError && (
            <div role="alert" className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl">
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

      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
