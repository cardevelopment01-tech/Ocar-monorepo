import api from './api'
import type { AdminRole } from './mock-data'

export interface AdminAccount {
  id: string
  code: string
  email: string
  role: AdminRole
  admin_status: 'active' | 'suspended'
  created_at: string
}

export const adminAccountsApi = {
  list: async (): Promise<AdminAccount[]> => {
    const { data } = await api.get<{ admins: AdminAccount[] }>('/api/v1/admin/admins')
    return data.admins
  },
}

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface AdminInvite {
  id: string
  email: string
  role: AdminRole
  invited_by: string
  status: InviteStatus
  expires_at: string
  accepted_at: string | null
  accepted_admin_id: string | null
  created_at: string
  updated_at: string
}

export const adminInvitesApi = {
  list: async (): Promise<AdminInvite[]> => {
    const { data } = await api.get<{ invites: AdminInvite[] }>('/api/v1/admin/invites')
    return data.invites
  },

  create: async (params: { email: string; role: AdminRole }): Promise<AdminInvite> => {
    const { data } = await api.post<{ invite: AdminInvite }>('/api/v1/admin/invites', params)
    return data.invite
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
