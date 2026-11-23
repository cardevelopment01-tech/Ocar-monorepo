'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { adminAccountsApi, type AdminAccount, type AdminLifecycleAction } from '@/lib/admin-invites-api'
import { extractErrorMessage } from '@/lib/http-errors'
import type { AdminRole } from '@/lib/mock-data'

const ROLES: Array<{ value: AdminRole; label: string }> = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'ops_admin', label: 'Ops Admin' },
  { value: 'support_admin', label: 'Support Admin' },
  { value: 'finance_admin', label: 'Finance Admin' },
]

const COPY: Record<AdminLifecycleAction, { title: string; blurb: (email: string) => string; button: string; danger: boolean }> = {
  role: { title: 'Change role', blurb: e => `${e} gets the new role on their next request.`, button: 'Change role', danger: false },
  reset2fa: { title: 'Reset 2FA', blurb: e => `${e} is signed out everywhere and sets up 2FA again at their next sign-in. Use this when they lost their phone.`, button: 'Reset 2FA', danger: true },
  signOut: { title: 'Sign out everywhere', blurb: e => `Every session ${e} has open stops working now. They can sign in again.`, button: 'Sign out', danger: true },
  remove: { title: 'Remove admin', blurb: e => `${e} is signed out and can no longer sign in. Their past actions stay in the audit log. You can invite the same address again later.`, button: 'Remove admin', danger: true },
}

interface Props {
  target: AdminAccount | null
  action: AdminLifecycleAction | null
  onClose: () => void
  /** Called after success with the updated account (null when the account was removed) and a message for the toast. */
  onDone: (updated: AdminAccount | null, removedId: string | null, message: string) => void
}

export default function ManageAdminDialog({ target, action, onClose, onDone }: Props) {
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AdminRole>('ops_admin')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPassword(''); setConfirmEmail(''); setError(null); setBusy(false)
    if (target) setRole(target.role === 'ops_admin' ? 'support_admin' : 'ops_admin')
  }, [target?.id, action]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = !!target && !!action
  const copy = action ? COPY[action] : null
  const needsEmail = action === 'remove'
  const canSubmit = !busy && password.length > 0 && (!needsEmail || confirmEmail.trim().toLowerCase() === target?.email.toLowerCase()) && (action !== 'role' || role !== target?.role)

  const submit = async () => {
    if (!target || !action || !canSubmit) return
    setBusy(true); setError(null)
    try {
      if (action === 'role') {
        const updated = await adminAccountsApi.changeRole(target.id, role, password)
        onDone(updated, null, `${updated.email} is now ${ROLES.find(r => r.value === updated.role)?.label}`)
      } else if (action === 'reset2fa') {
        const updated = await adminAccountsApi.resetTwoFactor(target.id, password)
        onDone(updated, null, `2FA reset for ${updated.email}`)
      } else if (action === 'signOut') {
        await adminAccountsApi.signOut(target.id, password)
        onDone(null, null, `${target.email} signed out everywhere`)
      } else {
        await adminAccountsApi.remove(target.id, password, confirmEmail)
        onDone(null, target.id, `${target.email} removed`)
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Something went wrong. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-hover">
          <Dialog.Title className="mb-2 text-lg font-bold text-text-primary">{copy?.title}</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm leading-relaxed text-text-secondary">{target && copy ? copy.blurb(target.email) : ''}</Dialog.Description>

          <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-3">
            {action === 'role' && (
              <label className="block text-xs font-medium text-text-secondary">
                New role
                <select value={role} onChange={e => setRole(e.target.value as AdminRole)} className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
            )}
            {needsEmail && (
              <label className="block text-xs font-medium text-text-secondary">
                Type <span className="font-semibold text-text-primary">{target?.email}</span> to confirm
                <input value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
              </label>
            )}
            <label className="block text-xs font-medium text-text-secondary">
              Your password (to confirm it is you)
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
            </label>
            {error && <p role="alert" className="rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-2">Cancel</button>
              <button type="submit" disabled={!canSubmit} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${copy?.danger ? 'bg-danger hover:bg-red-600' : 'bg-primary hover:opacity-90'}`}>
                {busy ? 'Working…' : copy?.button}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
