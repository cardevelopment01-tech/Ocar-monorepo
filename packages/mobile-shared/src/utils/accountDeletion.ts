import type { AxiosInstance } from 'axios'

// Google Play requires in-app account deletion. The server erases personal data and closes the account;
// it refuses (409 ACCOUNT_HAS_ACTIVE_RIDE / _BALANCE / _PENDING_PAYOUT) while a ride, wallet balance or payout
// is open, with a message the app shows as-is.
export async function requestAccountDeletion(api: AxiosInstance): Promise<void> {
  await api.delete('/api/v1/account', { data: { confirm: true } })
}

export const DELETE_ACCOUNT_WARNING =
  'This permanently erases your personal data and signs you out. Ride and payment records we are legally required to keep stay, without your name or phone number. You cannot undo this.'
