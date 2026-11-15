// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown>) => rest
  const cache = new Map<string, unknown>()
  const motion = new Proxy({}, {
    get: (_t, tag: string) => {
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
const upload = vi.fn()
vi.mock('@/lib/admin-api', () => ({ adminDriverApi: { uploadDocument: (...a: unknown[]) => upload(...a) } }))

import UploadDocDrawer, { type UploadTarget } from '../UploadDocDrawer'

const target = (over: Partial<UploadTarget> = {}): UploadTarget => ({ kind: 'driver', docType: 'aadhaar_front', existing: null, ...over })
const jpg = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' })

function setup(t: UploadTarget) {
  const onDone = vi.fn()
  const onStale = vi.fn()
  const view = render(<UploadDocDrawer driverId="9" target={t} onClose={vi.fn()} onDone={onDone} onStale={onStale} />)
  const fileInput = view.container.ownerDocument.querySelector('input[type=file]') as HTMLInputElement
  return { onDone, onStale, fileInput }
}
const choose = (input: HTMLInputElement, f: File) => fireEvent.change(input, { target: { files: [f] } })
const reason = () => fireEvent.change(screen.getByLabelText('Why are you uploading this?'), { target: { value: 'Driver could not upload' } })

beforeEach(() => {
  upload.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

describe('UploadDocDrawer', () => {
  it('keeps both buttons off until there is a file and a reason', () => {
    const { fileInput } = setup(target())
    const review = screen.getByRole('button', { name: 'Upload for review' })
    expect(review).toBeDisabled()
    choose(fileInput, jpg())
    expect(review).toBeDisabled()
    reason()
    expect(review).toBeEnabled()
  })

  it('rejects a file that is not an image or PDF', () => {
    const { fileInput } = setup(target())
    choose(fileInput, new File(['x'], 'a.gif', { type: 'image/gif' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/JPG, PNG or PDF/)
  })

  it('approve needs an expiry for a dated document', () => {
    const { fileInput } = setup(target({ kind: 'vehicle', docType: 'insurance' }))
    choose(fileInput, jpg()); reason()
    expect(screen.getByRole('button', { name: 'Upload & approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload for review' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Expiry date on the document'), { target: { value: '2099-01-01' } })
    expect(screen.getByRole('button', { name: 'Upload & approve' })).toBeEnabled()
  })

  it('warns when replacing an approved document and sends the version it saw', async () => {
    upload.mockResolvedValue({ status: 'pending', submitted: false })
    const { fileInput, onDone } = setup(target({ existing: { status: 'approved', fileUrl: 'https://x/y.jpg', updatedAt: '2026-11-01T00:00:00.000Z', uploadedByEmail: null } }))
    expect(screen.getByText(/replaces an approved document/i)).toBeInTheDocument()
    choose(fileInput, jpg()); reason()
    fireEvent.click(screen.getByRole('button', { name: 'Upload for review' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(upload.mock.calls[0]![1]).toMatchObject({ approve: false, seen_updated_at: '2026-11-01T00:00:00.000Z', reason: 'Driver could not upload' })
  })

  it('profile photo needs the reference-selfie confirmation', () => {
    const { fileInput } = setup(target({ docType: 'profile_photo' }))
    choose(fileInput, jpg()); reason()
    expect(screen.getByRole('button', { name: 'Upload for review' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Upload for review' })).toBeEnabled()
  })

  it('a changed document (409) asks the page to reload', async () => {
    upload.mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 409, data: { code: 'DOC_CHANGED', error: 'changed' } } }))
    const { fileInput, onStale } = setup(target())
    choose(fileInput, jpg()); reason()
    fireEvent.click(screen.getByRole('button', { name: 'Upload for review' }))
    await waitFor(() => expect(onStale).toHaveBeenCalled())
  })
})
