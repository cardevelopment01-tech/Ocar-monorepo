import type { AdminRole } from '@/constants/enums'

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

/** 'unknown' = sent before delivery was tracked. */
export type InviteEmailStatus = 'unknown' | 'queued' | 'sent' | 'failed'

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
  email_status: InviteEmailStatus
  email_error: string | null
  email_updated_at: Date | null
  link_issued_at: Date
  created_at: Date
  updated_at: Date
}

// link_issued_at only drives the resend cooldown inside the database; it is not part of what leaves this module.
export type AdminInviteListItem = Omit<AdminInviteRecord, 'token_hash' | 'link_issued_at'>

export interface CreatedAdminFromInvite {
  id: string
  code: string
  email: string
  role: AdminRole
}
