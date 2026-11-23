import type { AdminRole } from '@/lib/mock-data'

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  ops_admin: 'Ops Admin',
  support_admin: 'Support Admin',
  finance_admin: 'Finance Admin',
}

// What each role can actually reach (from the API's requireAdmin lists). Shown to the person choosing a role and to the person invited.
export const ROLE_HELP: Record<AdminRole, string> = {
  super_admin: 'Everything, including managing admins, settings and pricing.',
  ops_admin: 'Day-to-day operations: drivers, vehicles, rides and dispatch.',
  support_admin: 'Looks up rides, riders and drivers to help with support cases. Cannot approve drivers.',
  finance_admin: 'Payments, settlements, offers and revenue reports.',
}
