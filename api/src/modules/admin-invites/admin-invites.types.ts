import type { AdminRole } from '@/constants/enums'

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

// pg returns BIGINT columns as strings; id is typed as string here.
export interface AdminInviteRecord {
  id: string
  email: string
  role: AdminRole
  token_hash: string
  invited_by: string
  status: InviteStatus
  expires_at: Date
  accepted_at: Date | null
  accepted_admin_id: string | null
  created_at: Date
  updated_at: Date
}

export type AdminInviteListItem = Omit<AdminInviteRecord, 'token_hash'>

export interface CreatedAdminFromInvite {
  id: string
  code: string
  email: string
  role: AdminRole
}
