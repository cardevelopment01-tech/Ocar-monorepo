// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const totp = vi.hoisted(() => ({ status: vi.fn(), setup: vi.fn() }))
vi.mock('@/lib/totp-api', () => ({ totpApi: totp }))

import SecurityPage from '../page'

// Value: protects=a new admin who has just accepted an invite lands on a welcome note with the 2FA setup already open (no extra click), while
// anyone else opening the page still has to choose to start it; fails_when=the setup does not open after an invite, opens for everyone, or
// the welcome shows for someone who already has 2FA; why_new=accepting an invite used to end at the login page; seam=the 2FA API client.

const at = (search: string) => window.history.replaceState({}, '', `/security${search}`)

describe('Security page after accepting an invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    totp.status.mockResolvedValue({ totpEnabled: false, mandatory: false })
    totp.setup.mockResolvedValue({ secret: 'ABCDEF', qrDataUrl: 'data:image/png;base64,AAAA' })
  })

  it('with ?setup=1 it welcomes them and opens the setup straight away, with a way to skip', async () => {
    at('?setup=1')
    render(<SecurityPage />)
    expect(await screen.findByText(/Welcome to Ocar admin/)).toBeInTheDocument()
    expect(await screen.findByAltText('2FA setup QR code')).toBeInTheDocument()
    expect(totp.setup).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Skip for now' })).toHaveAttribute('href', '/overview')
  })

  it('without it nothing opens by itself and there is no welcome', async () => {
    at('')
    render(<SecurityPage />)
    expect(await screen.findByRole('button', { name: 'Enable 2FA' })).toBeInTheDocument()
    expect(totp.setup).not.toHaveBeenCalled()
    expect(screen.queryByText(/Welcome to Ocar admin/)).toBeNull()
  })

  it('someone who already has 2FA does not get the setup opened', async () => {
    at('?setup=1')
    totp.status.mockResolvedValue({ totpEnabled: true, mandatory: false })
    render(<SecurityPage />)
    await screen.findByText(/Two-factor authentication/)
    expect(totp.setup).not.toHaveBeenCalled()
    expect(screen.queryByText(/Welcome to Ocar admin/)).toBeNull()
  })
})
