// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminAccount, AdminInvite } from '@/lib/admin-invites-api'

const accounts = vi.hoisted(() => ({ list: vi.fn(), setStatus: vi.fn(), changeRole: vi.fn(), resetTwoFactor: vi.fn(), signOut: vi.fn(), remove: vi.fn() }))
const invites = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn(), resend: vi.fn() }))
vi.mock('@/lib/admin-invites-api', () => ({ adminAccountsApi: accounts, adminInvitesApi: invites }))
vi.mock('@/lib/auth-context', () => ({ useAdminAuth: () => ({ admin: { id: '1' } }) }))

import AdminsPage from '../page'

// Value: protects=a super admin always sees the truth about the team: a failed load is an error with a retry (never "no admins yet"), an
// expired invite is labelled expired and can be sent again in one click, and every action says whether it worked, with the server's own
// reason when it did not; fails_when=a failed load shows an empty table, a failed revoke/suspend/invite is silent or shows a generic
// message, an expired invite still looks pending, or the person's own row offers to suspend themselves; why_new=the page swallowed load
// errors and had no feedback on any action; seam=the API client is replaced; no_claim=real requests.

const account = (over: Partial<AdminAccount> = {}): AdminAccount => ({
  id: '2', code: 'ADM000002', email: 'ops@ocar.test', role: 'ops_admin', admin_status: 'active', totp_enabled: true, last_login_at: null, created_at: '2026-11-01T00:00:00.000Z', ...over,
})
const invite = (over: Partial<AdminInvite> = {}): AdminInvite => ({
  id: '11', email: 'new@ocar.test', role: 'support_admin', invited_by: '1', status: 'pending', expires_at: '2026-11-25T00:00:00.000Z',
  accepted_at: null, accepted_admin_id: null, email_status: 'sent', email_error: null, created_at: '2026-11-23T00:00:00.000Z', updated_at: '2026-11-23T00:00:00.000Z', ...over,
})
const LINK = 'https://admin.ocar.example/accept-invite?token=abc123def456'
const issued = (over: Partial<AdminInvite> = {}) => ({ invite: invite(over), link: LINK })
const httpError = (status: number, error?: string) => ({ isAxiosError: true, response: { status, data: error ? { error } : {} } })

describe('Admins page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accounts.list.mockResolvedValue([account({ id: '1', email: 'me@ocar.test', role: 'super_admin' }), account()])
    invites.list.mockResolvedValue([invite()])
  })

  it('lists admins and invites, and never offers to suspend yourself', async () => {
    render(<AdminsPage />)
    expect(await screen.findByText('ops@ocar.test')).toBeInTheDocument()
    expect(screen.getByText('new@ocar.test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspend ops@ocar.test' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend me@ocar.test' })).toBeNull()
  })

  it('shows "access restricted" for anyone who is not a super admin', async () => {
    accounts.list.mockRejectedValue(httpError(403))
    invites.list.mockRejectedValue(httpError(403))
    render(<AdminsPage />)
    expect(await screen.findByText('Access restricted')).toBeInTheDocument()
  })

  it('a failed load is an error with a retry, not an empty table, and retrying brings the data back', async () => {
    const user = userEvent.setup()
    accounts.list.mockRejectedValueOnce(httpError(500)).mockResolvedValue([account()])
    invites.list.mockRejectedValueOnce(new Error('network')).mockResolvedValue([invite()])
    render(<AdminsPage />)

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Could not load admin accounts/)
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Could not load invites/)
    expect(screen.queryByText('No admin accounts yet')).toBeNull() // that would be a lie
    expect(screen.queryByText('No invites sent yet')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: /Try again/ })[0]!)
    expect(await screen.findByText('ops@ocar.test')).toBeInTheDocument()
    expect(accounts.list).toHaveBeenCalledTimes(2)
  })

  describe('an invite nobody answered, and a revoked one', () => {
    beforeEach(() => invites.list.mockResolvedValue([invite({ status: 'expired' }), invite({ id: '12', email: 'gone@ocar.test', status: 'revoked', role: 'finance_admin' })]))

    it('are labelled, an expired one offers Resend (not Revoke), and a revoked one can be invited again in one click with the same person and role', async () => {
      const user = userEvent.setup()
      invites.create.mockResolvedValue(issued({ id: '13', email: 'gone@ocar.test', role: 'finance_admin', status: 'pending', email_status: 'queued' }))
      render(<AdminsPage />)

      expect(await screen.findByText('Expired')).toBeInTheDocument()
      expect(screen.getByText('Revoked')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Revoke the invite/ })).toBeNull()
      expect(screen.getByRole('button', { name: 'Resend the invite to new@ocar.test' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Invite gone@ocar.test again' }))
      expect(screen.getByLabelText('Email address')).toHaveValue('gone@ocar.test')
      expect(screen.getByLabelText('Role')).toHaveValue('finance_admin')

      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      await waitFor(() => expect(invites.create).toHaveBeenCalledWith({ email: 'gone@ocar.test', role: 'finance_admin' }))
      expect(await screen.findByText(/We are emailing gone@ocar.test/)).toBeInTheDocument()
    })
  })

  describe('sending an invite', () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      render(<AdminsPage />)
      await screen.findByText('ops@ocar.test')
      await user.click(screen.getByRole('button', { name: /Invite Admin/ }))
    }

    it('sends the address in lower case with the chosen role', async () => {
      const user = userEvent.setup()
      invites.create.mockResolvedValue(issued({ id: '14', email: 'sam@ocar.test', role: 'finance_admin' }))
      await open(user)
      await user.type(screen.getByLabelText('Email address'), ' Sam@OCAR.test')
      await user.selectOptions(screen.getByLabelText('Role'), 'finance_admin')
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      await waitFor(() => expect(invites.create).toHaveBeenCalledWith({ email: 'sam@ocar.test', role: 'finance_admin' }))
    })

    it('says the invite link lasts 48 hours and works once', async () => {
      await open(userEvent.setup())
      expect(screen.getByText(/works for 48 hours and can be used once/)).toBeInTheDocument()
    })

    it("shows the server's own reason (already an admin, already invited), and keeps the panel open to fix it", async () => {
      const user = userEvent.setup()
      invites.create.mockRejectedValueOnce(httpError(409, 'An admin account with this email already exists'))
      await open(user)
      await user.type(screen.getByLabelText('Email address'), 'ops@ocar.test')
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      expect(await screen.findByText('An admin account with this email already exists')).toBeInTheDocument()
      expect(screen.getByLabelText('Email address')).toHaveValue('ops@ocar.test') // the panel stays open, with what was typed

      invites.create.mockRejectedValueOnce(httpError(409, 'A pending invite already exists for this email'))
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      expect(await screen.findByText('A pending invite already exists for this email')).toBeInTheDocument()
    })

    it('asks for an address before calling the server', async () => {
      const user = userEvent.setup()
      await open(user)
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      expect(await screen.findByText('Enter an email address.')).toBeInTheDocument()
      expect(invites.create).not.toHaveBeenCalled()
    })
  })

  describe('revoking an invite', () => {
    it('confirms, updates the row and says so', async () => {
      const user = userEvent.setup()
      invites.revoke.mockResolvedValue(invite({ status: 'revoked' }))
      render(<AdminsPage />)
      await user.click(await screen.findByRole('button', { name: 'Revoke the invite for new@ocar.test' }))
      await user.click(await screen.findByRole('button', { name: 'Revoke' }))
      expect(await screen.findByText('Invite revoked')).toBeInTheDocument()
      expect(await screen.findByText('Revoked')).toBeInTheDocument()
    })

    it('a failure is shown with its reason, and the invite stays pending', async () => {
      const user = userEvent.setup()
      invites.revoke.mockRejectedValue(httpError(404, 'Resource not found'))
      render(<AdminsPage />)
      await user.click(await screen.findByRole('button', { name: 'Revoke the invite for new@ocar.test' }))
      await user.click(await screen.findByRole('button', { name: 'Revoke' }))
      expect(await screen.findByText('Resource not found')).toBeInTheDocument()
      expect(screen.queryByText('Invite revoked')).toBeNull()
      expect(screen.getByText('Pending')).toBeInTheDocument()
    })
  })

  describe('suspending an admin', () => {
    it('suspends after a confirmation and says who', async () => {
      const user = userEvent.setup()
      accounts.setStatus.mockResolvedValue(account({ admin_status: 'suspended' }))
      render(<AdminsPage />)
      await user.click(await screen.findByRole('button', { name: 'Suspend ops@ocar.test' }))
      await user.click(await screen.findByRole('button', { name: 'Suspend' }))
      await waitFor(() => expect(accounts.setStatus).toHaveBeenCalledWith('2', 'suspended'))
      expect(await screen.findByText('ops@ocar.test suspended')).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: 'Reactivate ops@ocar.test' })).toBeInTheDocument()
    })

    it('a failure is shown, can be dismissed, and the admin stays active', async () => {
      const user = userEvent.setup()
      accounts.setStatus.mockRejectedValue(httpError(500))
      render(<AdminsPage />)
      await user.click(await screen.findByRole('button', { name: 'Suspend ops@ocar.test' }))
      await user.click(await screen.findByRole('button', { name: 'Suspend' }))
      expect(await screen.findByText(/The server hit a problem/)).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: 'Suspend ops@ocar.test' })).toBeInTheDocument() // still active

      await user.click(await screen.findByRole('button', { name: 'Dismiss this message' }))
      expect(screen.queryByText(/The server hit a problem/)).toBeNull()
    })
  })

  describe('the invite link after sending (the only time it can be copied)', () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      render(<AdminsPage />)
      await screen.findByText('ops@ocar.test')
      await user.click(screen.getByRole('button', { name: /Invite Admin/ }))
      await user.type(screen.getByLabelText('Email address'), 'sam@ocar.test')
    }
    it('stays open after sending, shows the link and copies it on one click', async () => {
      const user = userEvent.setup()
      invites.create.mockResolvedValue(issued({ id: '20', email: 'sam@ocar.test', email_status: 'queued' }))
      await open(user)
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      expect(await screen.findByText('Invite sent')).toBeInTheDocument()
      expect(screen.getByLabelText('Invite link')).toHaveValue(LINK)
      expect(screen.getByText(/We are emailing sam@ocar.test/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Email address')).toBeNull() // the form is gone

      await user.click(screen.getByRole('button', { name: 'Copy link' }))
      expect(await navigator.clipboard.readText()).toBe(LINK) // what really landed on the clipboard
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
      expect(screen.getByText(/shown only now/)).toBeInTheDocument()
    })

    it('says plainly when the email could not be sent, and still offers the link', async () => {
      const user = userEvent.setup()
      invites.create.mockResolvedValue(issued({ id: '21', email: 'sam@ocar.test', email_status: 'failed', email_error: 'The email could not be queued (the job queue is unavailable).' }))
      await open(user)
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      expect(await screen.findByText(/The email to sam@ocar.test could not be sent/)).toBeInTheDocument()
      expect(screen.getByLabelText('Invite link')).toHaveValue(LINK)
    })

    it('if the browser will not copy, the link is selected and the person is told to press Ctrl+C (nothing fails silently)', async () => {
      const user = userEvent.setup()
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
      invites.create.mockResolvedValue(issued({ id: '22', email: 'sam@ocar.test' }))
      await open(user)
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      await user.click(await screen.findByRole('button', { name: 'Copy link' }))
      expect(await screen.findByText(/Could not copy automatically/)).toBeInTheDocument()
    })

    it('Done closes the panel, and the link is gone: opening it again shows a fresh form, not the old link', async () => {
      const user = userEvent.setup()
      invites.create.mockResolvedValue(issued({ id: '23', email: 'sam@ocar.test' }))
      await open(user)
      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      await user.click(await screen.findByRole('button', { name: 'Done' }))
      await user.click(screen.getByRole('button', { name: /Invite Admin/ }))
      expect(await screen.findByLabelText('Email address')).toHaveValue('')
      expect(screen.queryByLabelText('Invite link')).toBeNull()
    })
  })

  describe('resending', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => undefined) } })
    })

    it('asks first (the old link stops working), then shows the new link, updates the row and says it was resent', async () => {
      const user = userEvent.setup()
      invites.resend.mockResolvedValue(issued({ email_status: 'queued' }))
      render(<AdminsPage />)
      await user.click(await screen.findByRole('button', { name: 'Resend the invite to new@ocar.test' }))
      expect(await screen.findByText(/the old link stops working/)).toBeInTheDocument()
      expect(invites.resend).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Resend' }))
      await waitFor(() => expect(invites.resend).toHaveBeenCalledWith('11'))
      expect(await screen.findByText('Invite resent')).toBeInTheDocument()
      expect(screen.getByLabelText('Invite link')).toHaveValue(LINK)
    })

    it('a lapsed invite can be resent too, but a revoked one only offers "invite again"', async () => {
      invites.list.mockResolvedValue([invite({ status: 'expired' }), invite({ id: '12', email: 'gone@ocar.test', status: 'revoked' })])
      render(<AdminsPage />)
      expect(await screen.findByRole('button', { name: 'Resend the invite to new@ocar.test' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Resend the invite to gone@ocar.test' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Invite gone@ocar.test again' })).toBeInTheDocument()
    })

    it("the server's wait message (\"Wait 42 seconds before resending\") is shown as written, not as a generic throttle", async () => {
      const user = userEvent.setup()
      invites.resend.mockRejectedValue({ isAxiosError: true, response: { status: 429, data: { error: 'Wait 42 seconds before resending', code: 'ADMIN_INVITE_RESEND_TOO_SOON' } } })
      render(<AdminsPage />)
      await user.click(await screen.findByRole('button', { name: 'Resend the invite to new@ocar.test' }))
      await user.click(await screen.findByRole('button', { name: 'Resend' }))
      expect(await screen.findByText('Wait 42 seconds before resending')).toBeInTheDocument()
      expect(screen.queryByLabelText('Invite link')).toBeNull()
    })
  })

  describe('did the email go out', () => {
    it('a failed email is shown on the row with the mail server\'s reason; "sent" and "sending" are quiet', async () => {
      invites.list.mockResolvedValue([
        invite({ id: '31', email: 'bad@ocar.test', email_status: 'failed', email_error: '535 5.7.8 Username and Password not accepted' }),
        invite({ id: '32', email: 'fine@ocar.test', email_status: 'sent' }),
        invite({ id: '33', email: 'old@ocar.test', email_status: 'unknown' }),
      ])
      render(<AdminsPage />)
      expect(await screen.findByText(/Email failed: 535 5.7.8 Username and Password not accepted/)).toBeInTheDocument()
      expect(screen.getByText('Email sent')).toBeInTheDocument()
      expect(screen.getAllByRole('status')).toHaveLength(1) // only the failure is announced
      expect(screen.queryByText(/Email failed.*old@/)).toBeNull() // an invite sent before tracking says nothing
    })

    it('an old accepted or revoked invite shows no email state at all', async () => {
      invites.list.mockResolvedValue([invite({ status: 'accepted', email_status: 'failed', email_error: 'x' }), invite({ id: '12', email: 'r@ocar.test', status: 'revoked', email_status: 'sent' })])
      render(<AdminsPage />)
      await screen.findByText('r@ocar.test')
      expect(screen.queryByText(/Email failed|Email sent|Sending email/)).toBeNull()
    })

    it('"Sending email…" turns into the result without a reload (the page looks again by itself)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        invites.list.mockResolvedValueOnce([invite({ email_status: 'queued' })]).mockResolvedValue([invite({ email_status: 'failed', email_error: 'connection timed out' })])
        render(<AdminsPage />)
        expect(await screen.findByText('Sending email…')).toBeInTheDocument()
        await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
        expect(await screen.findByText(/Email failed: connection timed out/)).toBeInTheDocument()
        expect(screen.queryByText('Sending email…')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('managing another admin', () => {
    const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
      render(<AdminsPage />)
      await screen.findByText('ops@ocar.test')
      await user.click(screen.getByRole('button', { name }))
    }

    it('offers the four actions for others but none for yourself, and Reset 2FA only when they have 2FA', async () => {
      accounts.list.mockResolvedValue([account({ id: '1', email: 'me@ocar.test', role: 'super_admin' }), account({ totp_enabled: false })])
      render(<AdminsPage />)
      await screen.findByText('ops@ocar.test')
      expect(screen.getByRole('button', { name: 'Change role of ops@ocar.test' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sign out ops@ocar.test everywhere' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove ops@ocar.test' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reset 2FA for ops@ocar.test' })).toBeNull()
      expect(screen.queryByRole('button', { name: /me@ocar.test/ })).toBeNull()
    })

    it('a wrong password keeps the dialog open with the server message, and nothing changes in the list', async () => {
      const user = userEvent.setup()
      accounts.changeRole.mockRejectedValue(httpError(403, 'That password is not right'))
      await open(user, 'Change role of ops@ocar.test')
      await user.type(screen.getByLabelText(/Your password/), 'nope')
      await user.click(screen.getByRole('button', { name: 'Change role' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('That password is not right')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(accounts.changeRole).toHaveBeenCalledWith('2', 'support_admin', 'nope')
    })

    it('changing the role updates the row and confirms', async () => {
      const user = userEvent.setup()
      accounts.changeRole.mockResolvedValue(account({ role: 'support_admin' }))
      await open(user, 'Change role of ops@ocar.test')
      await user.type(screen.getByLabelText(/Your password/), 'Admin@1234')
      await user.click(screen.getByRole('button', { name: 'Change role' }))
      expect(await screen.findByText('ops@ocar.test is now Support Admin')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('removing needs the email typed exactly and a password, then drops the row', async () => {
      const user = userEvent.setup()
      accounts.remove.mockResolvedValue(undefined)
      await open(user, 'Remove ops@ocar.test')
      const submit = screen.getByRole('button', { name: 'Remove admin' })
      await user.type(screen.getByLabelText(/Your password/), 'Admin@1234')
      expect(submit).toBeDisabled() // email not typed yet
      await user.type(screen.getByLabelText(/^Type .* to confirm/), 'ops@ocar.test')
      expect(submit).toBeEnabled()
      await user.click(submit)
      await waitFor(() => expect(screen.queryByText('ops@ocar.test')).toBeNull())
      expect(accounts.remove).toHaveBeenCalledWith('2', 'Admin@1234', 'ops@ocar.test')
    })
  })
})
