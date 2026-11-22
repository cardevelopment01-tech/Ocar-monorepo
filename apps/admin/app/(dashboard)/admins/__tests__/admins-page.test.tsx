// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminAccount, AdminInvite } from '@/lib/admin-invites-api'

const accounts = vi.hoisted(() => ({ list: vi.fn(), setStatus: vi.fn() }))
const invites = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }))
vi.mock('@/lib/admin-invites-api', () => ({ adminAccountsApi: accounts, adminInvitesApi: invites }))
vi.mock('@/lib/auth-context', () => ({ useAdminAuth: () => ({ admin: { id: '1' } }) }))

import AdminsPage from '../page'

// Value: protects=a super admin always sees the truth about the team: a failed load is an error with a retry (never "no admins yet"), an
// expired invite is labelled expired and can be sent again in one click, and every action says whether it worked, with the server's own
// reason when it did not; fails_when=a failed load shows an empty table, a failed revoke/suspend/invite is silent or shows a generic
// message, an expired invite still looks pending, or the person's own row offers to suspend themselves; why_new=the page swallowed load
// errors and had no feedback on any action; seam=the API client is replaced; no_claim=real requests.

const account = (over: Partial<AdminAccount> = {}): AdminAccount => ({
  id: '2', code: 'ADM000002', email: 'ops@ocar.test', role: 'ops_admin', admin_status: 'active', created_at: '2026-11-01T00:00:00.000Z', ...over,
})
const invite = (over: Partial<AdminInvite> = {}): AdminInvite => ({
  id: '11', email: 'new@ocar.test', role: 'support_admin', invited_by: '1', status: 'pending', expires_at: '2026-11-25T00:00:00.000Z',
  accepted_at: null, accepted_admin_id: null, created_at: '2026-11-23T00:00:00.000Z', updated_at: '2026-11-23T00:00:00.000Z', ...over,
})
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

  describe('an invite nobody answered', () => {
    beforeEach(() => invites.list.mockResolvedValue([invite({ status: 'expired' }), invite({ id: '12', email: 'gone@ocar.test', status: 'revoked' })]))

    it('is labelled expired, has no revoke button, and can be sent again in one click with the same person and role', async () => {
      const user = userEvent.setup()
      invites.create.mockResolvedValue(invite({ id: '13', status: 'pending' }))
      render(<AdminsPage />)

      expect(await screen.findByText('Expired')).toBeInTheDocument()
      expect(screen.getByText('Revoked')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Revoke the invite/ })).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Invite new@ocar.test again' }))
      expect(screen.getByLabelText('Email address')).toHaveValue('new@ocar.test')
      expect(screen.getByLabelText('Role')).toHaveValue('support_admin')

      await user.click(screen.getByRole('button', { name: /Send Invite/ }))
      await waitFor(() => expect(invites.create).toHaveBeenCalledWith({ email: 'new@ocar.test', role: 'support_admin' }))
      expect(await screen.findByText('Invite sent to new@ocar.test')).toBeInTheDocument()
      expect(screen.getAllByText('new@ocar.test').length).toBeGreaterThanOrEqual(2) // the new live invite is on top of the old expired row
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
      invites.create.mockResolvedValue(invite({ id: '14', email: 'sam@ocar.test', role: 'finance_admin' }))
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
})
