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
  since: '2026-11-25T10:00:00Z', href: '/sos', linkLabel: 'Open SOS console', urgent: true, ...over,
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
})
