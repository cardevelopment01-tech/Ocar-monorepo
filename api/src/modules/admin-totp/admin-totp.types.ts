import type { AdminRole } from '@/constants/enums'

export interface AdminTotpState {
  id: string
  email: string
  role: AdminRole
  totp_enabled: boolean
  totp_secret_enc: string | null
  totp_last_timestep: string | null
  password_hash: string
}

export interface RecoveryCodeRow {
  id: string
  code_hash: string
}
