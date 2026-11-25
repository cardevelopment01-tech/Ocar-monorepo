// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttentionPanel } from '../AttentionPanel'
import type { AttentionItem } from '@/lib/live-map-attention'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

const NOW = Date.parse('2026-11-25T10:10:00Z')
const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  key: 'sos:1', kind: 'sos', lat: 20.3, lng: 85.8, title: 'SOS · high', detail: 'triggered · ride 10 · rider Asha',
  since: '2026-11-25T10:00:00Z', href: '/sos', linkLabel: 'Open SOS console', urgent: true, rideId: '10', assignable: false, ...over,
})

describe('AttentionPanel', () => {
  it('shows what it is, how long ago, and the link to handle it', () => {
    render(<AttentionPanel item={item()} nowMs={NOW} onClose={vi.fn()} />)
    expect(screen.getByText('SOS alert')).toBeTruthy()
    expect(screen.getByText('SOS · high')).toBeTruthy()
    expect(screen.getByText('triggered · ride 10 · rider Asha')).toBeTruthy()
    expect(screen.getByText(/10m ago/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open SOS console' }).getAttribute('href')).toBe('/sos')
  })

  it('says nobody has acknowledged it only for an urgent item', () => {
    const { unmount } = render(<AttentionPanel item={item()} nowMs={NOW} onClose={vi.fn()} />)
    expect(screen.getByText(/nobody has acknowledged it/)).toBeTruthy()
    unmount()
    render(<AttentionPanel item={item({ urgent: false, kind: 'flagged', title: 'Ride flagged for review', href: '/rides/20', linkLabel: 'Open ride' })} nowMs={NOW} onClose={vi.fn()} />)
    expect(screen.queryByText(/nobody has acknowledged it/)).toBeNull()
    expect(screen.getByText('Flagged ride')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open ride' }).getAttribute('href')).toBe('/rides/20')
  })

  it('closes', async () => {
    const onClose = vi.fn()
    render(<AttentionPanel item={item()} nowMs={NOW} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  describe('assigning a driver', () => {
    const request = item({ kind: 'request', title: 'Waiting for a driver', detail: 'ride 30 · Airport', href: '/rides/30', linkLabel: 'Open ride', urgent: false, rideId: '30', assignable: true })

    it('offers "Assign a driver" for an unmet request and passes its ride', async () => {
      const onAssign = vi.fn()
      render(<AttentionPanel item={request} nowMs={NOW} onClose={vi.fn()} onAssign={onAssign} />)
      await userEvent.click(screen.getByRole('button', { name: 'Assign a driver' }))
      expect(onAssign).toHaveBeenCalledWith('30')
    })

    it('has no assign button when the viewer cannot assign (no handler)', () => {
      render(<AttentionPanel item={request} nowMs={NOW} onClose={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Assign a driver' })).toBeNull()
    })

    it('has no assign button for an SOS or a flagged ride, which already have a driver', () => {
      render(<AttentionPanel item={item()} nowMs={NOW} onClose={vi.fn()} onAssign={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Assign a driver' })).toBeNull()
    })
  })
})
