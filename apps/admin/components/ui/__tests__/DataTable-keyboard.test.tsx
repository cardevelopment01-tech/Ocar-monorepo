// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DataTable from '../DataTable'

const cols = [{ key: 'name', header: 'Name' }, { key: 'act', header: '', render: () => <button>Inner</button> }]
const data = [{ name: 'Row A' }]

describe('DataTable keyboard access', () => {
  it('makes a clickable row focusable and opens it with Enter or Space', () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={cols} data={data} onRowClick={onRowClick} />)
    const row = screen.getByText('Row A').closest('tr')!
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })
  it('ignores keys pressed on a control inside the row', () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={cols} data={data} onRowClick={onRowClick} />)
    fireEvent.keyDown(screen.getByText('Inner'), { key: 'Enter' })
    expect(onRowClick).not.toHaveBeenCalled()
  })
  it('leaves rows alone when nothing is clickable', () => {
    render(<DataTable columns={cols} data={data} />)
    expect(screen.getByText('Row A').closest('tr')).not.toHaveAttribute('tabindex')
  })
})
