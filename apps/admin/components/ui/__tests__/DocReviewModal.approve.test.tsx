// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { DriverDetail } from '@/lib/admin-api'

// framer-motion resolves its own nested React under vitest; animation isn't under test here.
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown>) => rest
  const cache = new Map<string, unknown>()
  const motion = new Proxy({}, {
    get: (_target, tag: string) => {
      if (!cache.has(tag)) {
        const C = React.forwardRef((props: Record<string, unknown>, ref) => React.createElement(tag, { ...strip(props), ref }))
        C.displayName = `motion.${tag}`
        cache.set(tag, C)
      }
      return cache.get(tag)
    },
  })
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children, useReducedMotion: () => false }
})

import DocReviewModal from '../DocReviewModal'

const doc = (id: string, doc_type: string) => ({
  id, doc_type, file_url: `https://x.test/${doc_type}.jpg`, status: 'pending', rejection_note: null,
  claimed_valid_until: null, updated_at: '2026-10-30T00:00:00Z',
})

function setup(order: string[], initialDocIndex = 0) {
  const detail = {
    full_name: 'Ramesh Kumar', phone: '+919876543299', code: 'DRV9', status: 'pending_approval',
    aadhaar_number: '123456789012', license_number: 'OD05', documents: order.map((t, i) => doc(String(i + 1), t)),
    vehicle_documents: [],
  } as unknown as DriverDetail
  const props = {
    detail, onClose: vi.fn(), onDriverAction: vi.fn().mockResolvedValue(undefined),
    onDriverDocApprove: vi.fn().mockResolvedValue(undefined), onDriverDocReject: vi.fn().mockResolvedValue(undefined),
    onVehicleDocApprove: vi.fn().mockResolvedValue(undefined), onVehicleDocReject: vi.fn().mockResolvedValue(undefined),
  }
  render(<DocReviewModal {...props} initialDocIndex={initialDocIndex} />)
  return props
}

describe('DocReviewModal one-key approve', () => {
  it('A approves a no-expiry document immediately, without the date panel', async () => {
    const p = setup(['profile_photo'])
    await act(async () => { fireEvent.keyDown(window, { key: 'a' }) })
    expect(p.onDriverDocApprove).toHaveBeenCalledWith('1', '', '2026-10-30T00:00:00Z')
    expect(screen.queryByText('Verified expiry date')).not.toBeInTheDocument()
  })

  it('a double A in the same frame approves once (state lags a frame, the ref lock does not)', async () => {
    const p = setup(['profile_photo'])
    await act(async () => {
      fireEvent.keyDown(window, { key: 'a' })
      fireEvent.keyDown(window, { key: 'a' })
    })
    expect(p.onDriverDocApprove).toHaveBeenCalledTimes(1)
  })

  it('A on a document with an expiry opens the date panel instead of approving', async () => {
    const p = setup(['driving_license_front'], 3) // placeholders for the other required docs sort ahead of it
    await act(async () => { fireEvent.keyDown(window, { key: 'a' }) })
    expect(p.onDriverDocApprove).not.toHaveBeenCalled()
    expect(await screen.findByText('Verified expiry date')).toBeInTheDocument()
  })

  it('a failed one-key approve surfaces the error in the panel so it can be retried', async () => {
    const p = setup(['profile_photo'])
    p.onDriverDocApprove.mockRejectedValueOnce(new Error('boom'))
    await act(async () => { fireEvent.keyDown(window, { key: 'a' }) })
    expect(await screen.findByText('Could not approve. Please try again.')).toBeInTheDocument()
  })

  it('Activate stays hidden until every required document is approved', () => {
    setup(['profile_photo'])
    expect(screen.queryByRole('button', { name: /Activate/ })).not.toBeInTheDocument()
  })
})
