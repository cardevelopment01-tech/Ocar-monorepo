// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReasonForm, PHOTO_PRESETS, DOC_PRESETS } from '../ui/DocReviewModal'

function setup(presets = PHOTO_PRESETS) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  render(
    <ReasonForm title="Reject" placeholder="why" confirmLabel="Reject Document" loading={false}
      presets={presets} onSubmit={onSubmit} onCancel={onCancel} />
  )
  return { onSubmit, onCancel, box: screen.getByPlaceholderText('why') as HTMLTextAreaElement }
}

describe('ReasonForm presets', () => {
  it('every preset satisfies the API minimum note length (10 chars)', () => {
    for (const p of [...PHOTO_PRESETS, ...DOC_PRESETS]) expect(p.text.trim().length).toBeGreaterThanOrEqual(10)
  })

  it('submit is disabled until a reason exists', () => {
    setup()
    expect(screen.getByText('Reject Document')).toBeDisabled()
  })

  it('tapping a chip fills the note and enables submit with exactly that text', () => {
    const { onSubmit, box } = setup()
    fireEvent.click(screen.getByText('Cap / glasses'))
    expect(box.value).toBe(PHOTO_PRESETS.find(p => p.label === 'Cap / glasses')!.text)
    fireEvent.click(screen.getByText('Reject Document'))
    expect(onSubmit).toHaveBeenCalledWith(box.value)
  })

  it('tapping another chip replaces the first; the note stays editable', () => {
    const { onSubmit, box } = setup()
    fireEvent.click(screen.getByText('Blurry / dark'))
    fireEvent.click(screen.getByText('Face not clear'))
    expect(box.value).toBe(PHOTO_PRESETS.find(p => p.label === 'Face not clear')!.text)
    fireEvent.change(box, { target: { value: box.value + ' Thanks.' } })
    fireEvent.click(screen.getByText('Reject Document'))
    expect(onSubmit).toHaveBeenCalledWith(expect.stringMatching(/ Thanks\.$/))
  })

  it('renders no chips when no presets are passed (driver-level reject forms)', () => {
    render(<ReasonForm title="t" placeholder="p2" confirmLabel="Go" loading={false} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.queryByText('Blurry / dark')).toBeNull()
  })

  it('doc presets are used for non-photo docs', () => {
    setup(DOC_PRESETS)
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Cap / glasses')).toBeNull()
  })
})
