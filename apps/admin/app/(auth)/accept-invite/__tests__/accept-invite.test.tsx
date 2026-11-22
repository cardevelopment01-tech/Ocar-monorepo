// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ verify: vi.fn(), redeem: vi.fn() }))
const nav = vi.hoisted(() => ({ push: vi.fn(), query: 'token=abc123' }))
vi.mock('@/lib/admin-invites-api', () => ({ adminInvitesApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(nav.query) }))

import AcceptInvitePage from '../page'

// Value: protects=a new admin is told the password rule up front (12 characters, with a live check), is stopped before a short password
// reaches the server, sees the server's own reason when it refuses one (breached, contains the company name), and a dead link never shows
// a form; fails_when=the old 8-character rule comes back, a weak password is sent anyway, a server refusal shows as a vague error, or an
// invalid link shows the password form; why_new=the rule changed from 8 characters with no hint at all; seam=the API client and router
// are replaced; no_claim=real requests.

const httpError = (status: number, error: string) => ({ isAxiosError: true, response: { status, data: { error } } })
const GOOD = 'a-long-passphrase-77'

describe('Accept invite page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nav.query = 'token=abc123'
    api.verify.mockResolvedValue({ email: 'new@ocar.test', role: 'ops_admin' })
  })

  const fill = async (user: ReturnType<typeof userEvent.setup>, password: string, confirm = password) => {
    await screen.findByText(/Set a password for new@ocar.test/)
    await user.type(screen.getByLabelText('New Password'), password)
    await user.type(screen.getByLabelText('Confirm Password'), confirm)
  }

  it('states the rule up front, and the hint turns satisfied at 12 characters', async () => {
    const user = userEvent.setup()
    render(<AcceptInvitePage />)
    await screen.findByText(/Set a password for new@ocar.test/)
    const hint = screen.getByText(/12 or more characters/)
    expect(hint).not.toHaveClass('text-success')
    expect(screen.getByPlaceholderText('At least 12 characters')).toBeInTheDocument()
    expect(screen.getByText(/checked? it against known data breaches|against known data breaches/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('New Password'), 'twelve-chars')
    expect(hint).toHaveClass('text-success')
  })

  it('a password under 12 characters never reaches the server (the old rule was 8)', async () => {
    const user = userEvent.setup()
    render(<AcceptInvitePage />)
    await fill(user, 'only-9-chr')
    await user.click(screen.getByRole('button', { name: /Activate Account/ }))
    expect(await screen.findByText('Password must be at least 12 characters.')).toBeInTheDocument()
    expect(api.redeem).not.toHaveBeenCalled()
  })

  it('two different passwords are not sent', async () => {
    const user = userEvent.setup()
    render(<AcceptInvitePage />)
    await fill(user, GOOD, 'a-different-passphrase-1')
    await user.click(screen.getByRole('button', { name: /Activate Account/ }))
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(api.redeem).not.toHaveBeenCalled()
  })

  it('a good password activates the account and goes to sign-in', async () => {
    const user = userEvent.setup()
    api.redeem.mockResolvedValue({ id: '9', code: 'ADM000009', email: 'new@ocar.test', role: 'ops_admin' })
    render(<AcceptInvitePage />)
    await fill(user, GOOD)
    await user.click(screen.getByRole('button', { name: /Activate Account/ }))
    await waitFor(() => expect(api.redeem).toHaveBeenCalledWith('abc123', GOOD))
    expect(nav.push).toHaveBeenCalledWith('/login?invited=1')
  })

  it("the server's reason is shown when it refuses the password (breached, or contains the company name), and the form stays", async () => {
    const user = userEvent.setup()
    api.redeem.mockRejectedValue(httpError(422, 'That password has appeared in a data breach, so it is not safe to use. Choose a different one.'))
    render(<AcceptInvitePage />)
    await fill(user, GOOD)
    await user.click(screen.getByRole('button', { name: /Activate Account/ }))
    expect(await screen.findByText(/has appeared in a data breach/)).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
    expect(screen.getByLabelText('New Password')).toBeInTheDocument() // can try another
  })

  it('a link that died between opening the page and submitting says so (400)', async () => {
    const user = userEvent.setup()
    api.redeem.mockRejectedValue(httpError(400, 'This invite link is invalid, expired, or already used'))
    render(<AcceptInvitePage />)
    await fill(user, GOOD)
    await user.click(screen.getByRole('button', { name: /Activate Account/ }))
    expect(await screen.findByText(/invalid, expired, or already used. Ask a super admin/)).toBeInTheDocument()
  })

  it('a dead or missing link never shows the password form', async () => {
    api.verify.mockRejectedValue(httpError(400, 'invalid'))
    render(<AcceptInvitePage />)
    expect(await screen.findByText('Invite unavailable')).toBeInTheDocument()
    expect(screen.queryByLabelText('New Password')).toBeNull()

    nav.query = ''
    render(<AcceptInvitePage />)
    expect((await screen.findAllByText('Invite unavailable')).length).toBe(2)
  })

  it('the show/hide button is labelled for screen readers and reveals the password', async () => {
    const user = userEvent.setup()
    render(<AcceptInvitePage />)
    await screen.findByText(/Set a password for new@ocar.test/)
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
  })
})
