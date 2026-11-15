// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { DocIssue } from '@/lib/admin-api'
import { DocCheckItem, formatDocDate } from '../shared'

// Value: protects=an admin looking at a driver's profile sees an approved-but-expired document as expired (with the date), not as a
// green "approved"; fails_when=the card keeps showing "approved" for a document the server says has expired, or the date is shifted;
// why_new=an expired insurance and pollution certificate read as approved, so the admin could not see why the driver could not go online
// and had to ask a developer; seam=none (the issue is passed in); no_claim=how the server decides (api tests).

const expired: DocIssue = {
  scope: 'vehicle', doc_type: 'insurance', label: 'Insurance', reason: 'expired', valid_until: '2026-10-30', note: null,
  short: 'Insurance expired on 30 Oct 2026', message: 'Insurance expired on 30 Oct 2026. Upload a renewed copy.',
}

describe('DocCheckItem', () => {
  it('shows an approved document that has expired as "Expired <date>", not as approved', () => {
    render(<DocCheckItem docType="insurance" fileUrl="https://x/y.jpg" status="approved" issue={expired} onClick={vi.fn()} />)
    expect(screen.getByText('Expired 30 Oct 2026')).toBeTruthy()
    expect(screen.queryByText('approved')).toBeNull()
  })

  it('still shows a normal approved document as approved', () => {
    render(<DocCheckItem docType="insurance" fileUrl="https://x/y.jpg" status="approved" issue={null} onClick={vi.fn()} />)
    expect(screen.getByText('approved')).toBeTruthy()
  })

  it('does not relabel a rejected document as expired', () => {
    render(<DocCheckItem docType="permit" fileUrl="https://x/y.jpg" status="rejected" rejectionNote="Blurry" issue={{ ...expired, doc_type: 'permit', reason: 'rejected' }} onClick={vi.fn()} />)
    expect(screen.getByText('Blurry')).toBeTruthy()
    expect(screen.queryByText(/Expired/)).toBeNull()
  })
})

describe('formatDocDate', () => {
  it('formats a date from its parts, so no timezone can move the day', () => {
    expect(formatDocDate('2026-11-07')).toBe('7 Nov 2026')
    expect(formatDocDate(null)).toBe('')
  })
})
