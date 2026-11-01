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

import DocReviewModal, { buildDocs } from '../DocReviewModal'

const UPDATED = '2026-10-30T00:00:00Z'
const FUTURE = '2099-01-01'

const vdoc = (id: string, doc_type: string, status: string, verified: string | null) => ({
  id, doc_type, file_url: `https://x.test/${doc_type}.jpg`, status, rejection_note: null,
  claimed_valid_until: null, verified_valid_until: verified, updated_at: UPDATED,
})

function setup(docType: string, status: string, verified: string | null, kind: 'driver' | 'vehicle' = 'vehicle') {
  const d = vdoc('7', docType, status, verified)
  const detail = {
    full_name: 'Ramesh Kumar', phone: '+919876543299', code: 'DRV9', status: 'active',
    aadhaar_number: '123456789012', license_number: 'OD05',
    documents: kind === 'driver' ? [d] : [], vehicle_documents: kind === 'vehicle' ? [d] : [],
  } as unknown as DriverDetail
  const props = {
    detail, onClose: vi.fn(), onDriverAction: vi.fn().mockResolvedValue(undefined),
    onDriverDocApprove: vi.fn().mockResolvedValue(undefined), onDriverDocReject: vi.fn().mockResolvedValue(undefined),
    onVehicleDocApprove: vi.fn().mockResolvedValue(undefined), onVehicleDocReject: vi.fn().mockResolvedValue(undefined),
    onDriverDocEditExpiry: vi.fn().mockResolvedValue(undefined), onVehicleDocEditExpiry: vi.fn().mockResolvedValue(undefined),
  }
  const initialDocIndex = buildDocs(detail).findIndex(x => x.id === '7')
  render(<DocReviewModal {...props} initialDocIndex={initialDocIndex} />)
  return props
}

describe('DocReviewModal edit expiry', () => {
  it('shows the stored expiry and an Edit expiry button on an approved expiring document', () => {
    setup('insurance', 'approved', '2026-10-12T00:00:00.000Z')
    expect(screen.getByText(/Expires 2026-10-12/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit expiry' })).toBeInTheDocument()
  })

  it('saves a new date without rejecting: calls the edit callback with the doc version, not approve/reject', async () => {
    const p = setup('insurance', 'approved', '2026-10-12T00:00:00.000Z')
    fireEvent.click(screen.getByRole('button', { name: 'Edit expiry' }))
    expect(screen.getByText(/Currently: 2026-10-12/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Verified expiry date'), { target: { value: FUTURE } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save expiry' })) })
    expect(p.onVehicleDocEditExpiry).toHaveBeenCalledWith('7', FUTURE, UPDATED)
    expect(p.onVehicleDocApprove).not.toHaveBeenCalled()
    expect(p.onVehicleDocReject).not.toHaveBeenCalled()
  })

  it('routes a driver (identity) document to the driver callback', async () => {
    const p = setup('driving_license_front', 'approved', '2026-07-14T00:00:00.000Z', 'driver')
    fireEvent.click(screen.getByRole('button', { name: 'Edit expiry' }))
    fireEvent.change(screen.getByLabelText('Verified expiry date'), { target: { value: FUTURE } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save expiry' })) })
    expect(p.onDriverDocEditExpiry).toHaveBeenCalledWith('7', FUTURE, UPDATED)
    expect(p.onVehicleDocEditExpiry).not.toHaveBeenCalled()
  })

  it('a stale date on a no-expiry type can be cleared (sends an empty date)', async () => {
    const p = setup('aadhaar_front', 'approved', '2026-09-09T00:00:00.000Z', 'driver')
    fireEvent.click(screen.getByRole('button', { name: 'Edit expiry' }))
    expect(screen.getByText(/Saving removes the expiry date/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save expiry' })) })
    expect(p.onDriverDocEditExpiry).toHaveBeenCalledWith('7', '', UPDATED)
  })

  it('offers nothing to edit on a clean no-expiry document, or on a document that is not approved', () => {
    setup('aadhaar_front', 'approved', null, 'driver')
    expect(screen.queryByRole('button', { name: 'Edit expiry' })).not.toBeInTheDocument()
  })

  it('does not offer Edit expiry on a pending document', () => {
    setup('insurance', 'pending', null)
    expect(screen.queryByRole('button', { name: 'Edit expiry' })).not.toBeInTheDocument()
  })

  it('a failed save keeps the form open with the error so it can be retried', async () => {
    const p = setup('insurance', 'approved', '2026-10-12T00:00:00.000Z')
    p.onVehicleDocEditExpiry.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit expiry' }))
    fireEvent.change(screen.getByLabelText('Verified expiry date'), { target: { value: FUTURE } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save expiry' })) })
    expect(await screen.findByText('Could not update the expiry. Please try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('Verified expiry date')).toBeInTheDocument()
  })

  it('Escape closes the edit form first, not the whole modal', () => {
    const p = setup('insurance', 'approved', '2026-10-12T00:00:00.000Z')
    fireEvent.click(screen.getByRole('button', { name: 'Edit expiry' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Verified expiry date')).not.toBeInTheDocument()
  })
})
