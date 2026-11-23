import api from './api'
import type { AdminRole } from './mock-data'

export interface AdminAccount {
  id: string
  code: string
  email: string
  role: AdminRole
  admin_status: 'active' | 'suspended'
  totp_enabled: boolean
  last_login_at: string | null
  created_at: string
}

export type AdminLifecycleAction = 'role' | 'reset2fa' | 'signOut' | 'remove'

export const adminAccountsApi = {
  list: async (): Promise<AdminAccount[]> => {
    const { data } = await api.get<{ admins: AdminAccount[] }>('/api/v1/admin/admins')
    return data.admins
  },

  setStatus: async (id: string, status: 'active' | 'suspended'): Promise<AdminAccount> => {
    const { data } = await api.patch<{ admin: AdminAccount }>(`/api/v1/admin/admins/${id}/status`, { status })
    return data.admin
  },

  // Risky actions re-ask for the acting admin's own password; the server checks it and answers 403 (not 401) when it is wrong.
  changeRole: async (id: string, role: AdminRole, password: string): Promise<AdminAccount> =>
    (await api.patch<{ admin: AdminAccount }>(`/api/v1/admin/admins/${id}/role`, { role, password })).data.admin,
  resetTwoFactor: async (id: string, password: string): Promise<AdminAccount> =>
    (await api.post<{ admin: AdminAccount }>(`/api/v1/admin/admins/${id}/reset-2fa`, { password })).data.admin,
  signOut: async (id: string, password: string): Promise<void> => { await api.post(`/api/v1/admin/admins/${id}/sign-out`, { password }) },
  remove: async (id: string, password: string, confirmEmail: string): Promise<void> => { await api.delete(`/api/v1/admin/admins/${id}`, { data: { password, confirmEmail } }) },
}

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

/** What happened to the invitation email. 'unknown' = sent before this was tracked. */
export type InviteEmailStatus = 'unknown' | 'queued' | 'sent' | 'failed'

export interface AdminInvite {
  id: string
  email: string
  role: AdminRole
  invited_by: string
  status: InviteStatus
  expires_at: string
  accepted_at: string | null
  accepted_admin_id: string | null
  email_status: InviteEmailStatus
  /** The mail server's own reason, when email_status is 'failed'. */
  email_error: string | null
  created_at: string
  updated_at: string
}

/** A new or resent invite plus its activation link. The link is returned only this once (the server keeps just its hash). */
export interface IssuedInvite {
  invite: AdminInvite
  link: string
}

export const adminInvitesApi = {
  list: async (): Promise<AdminInvite[]> => {
    const { data } = await api.get<{ invites: AdminInvite[] }>('/api/v1/admin/invites')
    return data.invites
  },

  create: async (params: { email: string; role: AdminRole }): Promise<IssuedInvite> => {
    const { data } = await api.post<IssuedInvite>('/api/v1/admin/invites', params)
    return data
  },

  /** A new link (the old one stops working) and the email again. */
  resend: async (id: string): Promise<IssuedInvite> => {
    const { data } = await api.post<IssuedInvite>(`/api/v1/admin/invites/${id}/resend`)
    return data
  },

  revoke: async (id: string): Promise<AdminInvite> => {
    const { data } = await api.patch<{ invite: AdminInvite }>(`/api/v1/admin/invites/${id}/revoke`)
    return data.invite
  },

  // Public — pre-flight check so accept-invite can show invalid/expired
  // before rendering the password form, instead of only failing on submit.
  verify: async (token: string): Promise<{ email: string; role: AdminRole }> => {
    const { data } = await api.get<{ email: string; role: AdminRole }>('/api/v1/admin/invites/verify', { params: { token } })
    return data
  },

  // Public — no admin session exists yet at redemption time.
  redeem: async (token: string, password: string): Promise<{ id: string; code: string; email: string; role: AdminRole }> => {
    const { data } = await api.post<{ admin: { id: string; code: string; email: string; role: AdminRole } }>(
      '/api/v1/admin/invites/redeem',
      { token, password }
    )
    return data.admin
  },
}
