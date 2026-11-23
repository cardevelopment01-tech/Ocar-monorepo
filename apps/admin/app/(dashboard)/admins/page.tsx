'use client'

import { useEffect, useRef, useState } from 'react'
import { UserPlus, UserCog, KeyRound, LogOut, Trash2, X, Send, Ban, ShieldOff, ShieldCheck, RotateCw, AlertCircle, RefreshCw, Mail, Copy, Check } from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import StatusPill from '@/components/ui/StatusPill'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SuccessToast from '@/components/ui/SuccessToast'
import ManageAdminDialog from './ManageAdminDialog'
import { adminInvitesApi, adminAccountsApi, type AdminInvite, type AdminAccount, type AdminLifecycleAction } from '@/lib/admin-invites-api'
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

// What the page shows after sending or resending: the one and only time the activation link can be copied (the server keeps just a hash).
interface Issued { email: string; link: string; kind: 'sent' | 'resent'; emailFailed: boolean }

function IssuedPanel({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.link)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // No clipboard access (an insecure page, or a blocked permission): select the text so Ctrl+C works.
      setCopyFailed(true)
      input.current?.select()
    }
  }
  return (
    <div className="p-6 space-y-5">
      {issued.emailFailed ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-light px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>The email to {issued.email} could not be sent. Copy the link below and send it to them yourself.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl bg-primary-light px-4 py-3 text-sm text-text-primary">
          <Mail size={16} className="mt-0.5 flex-shrink-0 text-primary" />
          <span>We are emailing {issued.email}. If it does not arrive, copy the link below and send it to them yourself.</span>
        </div>
      )}

      <div>
        <label htmlFor="invite-link" className="block text-xs font-semibold text-text-secondary mb-1.5">Invite link</label>
        <div className="flex gap-2">
          <input
            id="invite-link" ref={input} readOnly value={issued.link} onFocus={e => e.currentTarget.select()}
            className="min-w-0 flex-1 px-3 py-2 text-xs border border-border rounded-xl bg-surface-2 text-text-secondary outline-none focus:border-primary"
          />
          <button
            type="button" onClick={() => void copy()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity cursor-pointer"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {copyFailed && <p role="alert" className="mt-1.5 text-[11px] text-danger">Could not copy automatically. The link is selected: press Ctrl+C.</p>}
      </div>

      <ul className="space-y-1.5 text-[12px] text-text-muted">
        <li>The link works once and for 48 hours.</li>
        <li>It is shown only now. If you lose it, use Resend: that makes a new link and the old one stops working.</li>
        <li>Anyone with the link can activate this account, so send it only to {issued.email}.</li>
      </ul>

      <button
        type="button" onClick={onDone}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
      >
        Done
      </button>
    </div>
  )
}

// What happened to an invite's email. Only a live invite shows it (and a lapsed one only when it failed): an old accepted invite's email is history.
function EmailState({ invite }: { invite: AdminInvite }) {
  if (invite.status !== 'pending' && invite.status !== 'expired') return null
  if (invite.email_status === 'failed') {
    return (
      <span role="status" className="mt-0.5 flex items-start gap-1 text-[11px] leading-4 text-danger">
        <AlertCircle size={11} className="mt-px flex-shrink-0" />
        <span>Email failed{invite.email_error ? `: ${invite.email_error}` : ''}</span>
      </span>
    )
  }
  if (invite.status !== 'pending') return null
  if (invite.email_status === 'queued') return <span className="mt-0.5 block text-[11px] text-text-muted">Sending email…</span>
  if (invite.email_status === 'sent') return <span className="mt-0.5 block text-[11px] text-text-muted">Email sent</span>
  return null
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
  const [resendTarget, setResendTarget] = useState<AdminInvite | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminAccount | null>(null)
  const [manage, setManage] = useState<{ target: AdminAccount; action: AdminLifecycleAction } | null>(null)

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

  // quiet: a background refresh that must not flash the loading state or replace the list with an error.
  const loadInvites = async (quiet = false) => {
    if (!quiet) { setLoadingInvites(true); setInvitesFailed(false) }
    try {
      setInvites(await adminInvitesApi.list())
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 403) setForbidden(true)
      else if (!quiet) setInvitesFailed(true)
    } finally {
      if (!quiet) setLoadingInvites(false)
    }
  }

  useEffect(() => {
    void loadAdmins()
    void loadInvites()
  }, [])

  // An email that is still being sent: look again every few seconds (a handful of times) so "Sending email…" becomes "Email sent" or "Email failed".
  const sendingEmail = invites.some(i => i.status === 'pending' && i.email_status === 'queued')
  useEffect(() => {
    if (!sendingEmail) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      void loadInvites(true)
      if (tries >= 10) clearInterval(timer)
    }, 3000)
    return () => clearInterval(timer)
  }, [sendingEmail])

  // Opening from an expired or revoked invite pre-fills the same person and role: "invite again" is one click.
  const openInvite = (email = '', role: AdminRole = 'ops_admin') => {
    setInviteEmail(email)
    setInviteRole(role)
    setInviteError(null)
    setIssued(null)
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
      const { invite, link } = await adminInvitesApi.create({ email: inviteEmail.trim().toLowerCase(), role: inviteRole })
      // A re-invite leaves the old expired row in the list too; the new one goes on top.
      setInvites(prev => [invite, ...prev])
      // The panel stays open and shows the link: it cannot be shown again later.
      setIssued({ email: invite.email, link, kind: 'sent', emailFailed: invite.email_status === 'failed' })
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

  const confirmResend = async () => {
    if (!resendTarget) return
    setActionError(null)
    try {
      const { invite, link } = await adminInvitesApi.resend(resendTarget.id)
      setInvites(prev => prev.map(i => (i.id === invite.id ? invite : i)))
      setIssued({ email: invite.email, link, kind: 'resent', emailFailed: invite.email_status === 'failed' })
      setInviting(true)
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err, 'Could not resend the invite. Please try again.'))
    }
  }

  const closePanel = () => { setInviting(false); setIssued(null) }

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

  const afterManage = (updated: AdminAccount | null, removedId: string | null, message: string) => {
    if (updated) setAdmins(prev => prev.map(a => (a.id === updated.id ? updated : a)))
    if (removedId) setAdmins(prev => prev.filter(a => a.id !== removedId))
    setManage(null)
    setToast(message)
  }

  const adminColumns = [
    { key: 'email', header: 'Email', render: (a: AdminAccount) => <span className="text-sm font-medium text-text-primary">{a.email}</span> },
    { key: 'role', header: 'Role', width: '160px', render: (a: AdminAccount) => <RolePill role={a.role} /> },
    { key: 'admin_status', header: 'Status', width: '120px', render: (a: AdminAccount) => <StatusPill status={a.admin_status} /> },
    { key: 'totp_enabled', header: '2FA', width: '80px', render: (a: AdminAccount) => <span className={`text-xs ${a.totp_enabled ? 'text-success' : 'text-text-muted'}`}>{a.totp_enabled ? 'On' : 'Off'}</span> },
    { key: 'last_login_at', header: 'Last sign-in', width: '140px', render: (a: AdminAccount) => <span className="text-xs text-text-muted">{a.last_login_at ? formatDate(a.last_login_at) : 'Never'}</span> },
    { key: 'created_at', header: 'Joined', width: '140px', render: (a: AdminAccount) => <span className="text-xs text-text-muted">{formatDate(a.created_at)}</span> },
    {
      key: 'actions', header: '', width: '170px',
      render: (a: AdminAccount) => a.id === currentAdmin?.id ? null : (
        <div className="flex items-center gap-0.5">
        <button onClick={() => setManage({ target: a, action: 'role' })} className={ICON_BUTTON} title="Change role" aria-label={`Change role of ${a.email}`}><UserCog size={14} /></button>
        {a.totp_enabled && <button onClick={() => setManage({ target: a, action: 'reset2fa' })} className={ICON_BUTTON} title="Reset 2FA" aria-label={`Reset 2FA for ${a.email}`}><KeyRound size={14} /></button>}
        <button onClick={() => setManage({ target: a, action: 'signOut' })} className={ICON_BUTTON} title="Sign out everywhere" aria-label={`Sign out ${a.email} everywhere`}><LogOut size={14} /></button>
        <button onClick={() => setManage({ target: a, action: 'remove' })} className={ICON_BUTTON} title="Remove admin" aria-label={`Remove ${a.email}`}><Trash2 size={14} /></button>
        <button
          onClick={() => setStatusTarget(a)}
          className={ICON_BUTTON}
          title={a.admin_status === 'active' ? 'Suspend admin' : 'Reactivate admin'}
          aria-label={`${a.admin_status === 'active' ? 'Suspend' : 'Reactivate'} ${a.email}`}
        >
          {a.admin_status === 'active' ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
        </button>
        </div>
      ),
    },
  ]

  const inviteColumns = [
    { key: 'email', header: 'Email', render: (i: AdminInvite) => <div><span className="text-sm font-medium text-text-primary">{i.email}</span><EmailState invite={i} /></div> },
    { key: 'role', header: 'Role', width: '160px', render: (i: AdminInvite) => <RolePill role={i.role} /> },
    { key: 'status', header: 'Status', width: '110px', render: (i: AdminInvite) => <StatusPill status={i.status} /> },
    { key: 'expires_at', header: 'Expires', width: '140px', render: (i: AdminInvite) => <span className="text-xs text-text-muted">{formatDate(i.expires_at)}</span> },
    {
      key: 'actions', header: '', width: '100px',
      render: (i: AdminInvite) => i.status === 'pending' || i.status === 'expired' ? (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setResendTarget(i)}
            className="text-text-muted hover:text-primary transition-colors p-1 rounded hover:bg-surface-2 cursor-pointer"
            title="Resend invite"
            aria-label={`Resend the invite to ${i.email}`}
          >
            <Mail size={14} />
          </button>
          {i.status === 'pending' && (
            <button
              onClick={() => setRevokeTarget(i)}
              className={ICON_BUTTON}
              title="Revoke invite"
              aria-label={`Revoke the invite for ${i.email}`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : i.status === 'revoked' ? (
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

      <SlideOver isOpen={inviting} onClose={closePanel} title={issued ? (issued.kind === 'sent' ? 'Invite sent' : 'Invite resent') : 'Invite Admin'}>
        {issued ? (
          <IssuedPanel issued={issued} onDone={closePanel} />
        ) : (
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
              onClick={closePanel}
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
        )}
      </SlideOver>

      <ConfirmDialog
        open={!!resendTarget}
        onOpenChange={open => { if (!open) setResendTarget(null) }}
        title="Resend this invite?"
        description={`${resendTarget?.email ?? ''} gets a new email with a new link, and the old link stops working. The 48 hours start again.`}
        confirmLabel="Resend"
        variant="warning"
        onConfirm={() => void confirmResend()}
      />

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

      <ManageAdminDialog target={manage?.target ?? null} action={manage?.action ?? null} onClose={() => setManage(null)} onDone={afterManage} />

      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
