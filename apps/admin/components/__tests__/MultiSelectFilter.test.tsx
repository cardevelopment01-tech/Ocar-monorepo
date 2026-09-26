// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MultiSelectFilter from '../ui/MultiSelectFilter'

const OPTIONS = [
  { value: '1', label: 'Bhubaneswar', count: 51 },
  { value: '2', label: 'Cuttack', count: 34 },
  { value: '3', label: 'Angul', count: 0 },
]

function setup(selected: string[] = [], onChange = vi.fn()) {
  render(<MultiSelectFilter label="City" options={OPTIONS} selected={selected} onChange={onChange} searchable />)
  return onChange
}

describe('MultiSelectFilter', () => {
  it('opens with the keyboard and shows per-option counts as checkboxes', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: 'City' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByText('51')).toBeInTheDocument()
  })

  it('arrow keys move focus and Space toggles the focused option', async () => {
    const user = userEvent.setup()
    const onChange = setup()
    await user.click(screen.getByRole('button', { name: 'City' }))
    const boxes = await screen.findAllByRole('checkbox')
    boxes[0]!.focus()
    await user.keyboard('{ArrowDown}')
    expect(boxes[1]).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(['2'])
  })

  it('Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: 'City' })
    await user.click(trigger)
    await screen.findAllByRole('checkbox')
    await user.keyboard('{Escape}')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(trigger).toHaveFocus()
  })

  it('announces the selection count, marks selected options and keeps zero-count options visible', async () => {
    const user = userEvent.setup()
    const onChange = setup(['3'])
    const trigger = screen.getByRole('button', { name: 'City, 1 selected' })
    await user.click(trigger)
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes.map(b => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    // selected zero-count option stays visible and can be unticked
    await user.click(boxes[2]!)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('search narrows the list; Clear resets the selection', async () => {
    const user = userEvent.setup()
    const onChange = setup(['1', '2'])
    await user.click(screen.getByRole('button', { name: 'City, 2 selected' }))
    await user.type(await screen.findByPlaceholderText('Search…'), 'cut')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
