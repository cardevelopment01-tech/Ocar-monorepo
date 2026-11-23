import { sha256 } from '@/lib/hash'
import { sendAdminInviteEmail, type AdminInviteEmailJob } from './admin-invite-email'
import * as repo from './admin-invites.repository'

// Kept apart from admin-invite-email.ts so that module (the wording, the link, the sending) stays free of the database layer.

/**
 * What the queue worker runs: sends the email and records the outcome on the invite, so the admin page can say "email failed" and why.
 * A failure is only recorded once no retry is left, so a hiccup that the retry fixes never shows as failed. The error is rethrown so the
 * queue still retries and logs it.
 */
export async function deliverAdminInviteEmail(job: AdminInviteEmailJob, finalAttempt: boolean): Promise<void> {
  const record = job.inviteId === undefined ? null : { id: BigInt(job.inviteId), tokenHash: sha256(job.rawToken) }
  try {
    await sendAdminInviteEmail(job)
  } catch (err) {
    if (record && finalAttempt) {
      await repo.markInviteEmail({ ...record, status: 'failed', error: err instanceof Error ? err.message : String(err) }).catch(() => undefined)
    }
    throw err
  }
  if (record) await repo.markInviteEmail({ ...record, status: 'sent' }).catch(() => undefined) // a failed status write must not fail an email that went out
}
