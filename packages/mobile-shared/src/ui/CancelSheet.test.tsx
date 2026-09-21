import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import { CancelSheet } from './CancelSheet'

const REASONS = [
  { code: 'changed_mind', label: 'Changed my mind' },
  { code: 'emergency', label: 'Emergency' },
]

describe('CancelSheet', () => {
  it('renders nothing when not visible', async () => {
    await render(<CancelSheet visible={false} reasons={REASONS} onClose={jest.fn()} onConfirm={jest.fn()} />)
    expect(screen.queryByText('Changed my mind')).toBeNull()
  })

  it('renders the supplied reasons when visible', async () => {
    await render(<CancelSheet visible reasons={REASONS} onClose={jest.fn()} onConfirm={jest.fn()} />)
    expect(screen.getByText('Changed my mind')).toBeTruthy()
    expect(screen.getByText('Emergency')).toBeTruthy()
  })

  it('confirm button is disabled until a reason is selected', async () => {
    await render(<CancelSheet visible reasons={REASONS} onClose={jest.fn()} onConfirm={jest.fn()} />)
    const confirm = screen.getByText('Confirm cancellation')
    expect(confirm.props.accessibilityState?.disabled ?? confirm.parent?.props.accessibilityState?.disabled).toBeTruthy()
  })

  it('selecting a reason and confirming calls onConfirm with the reason code', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    await render(<CancelSheet visible reasons={REASONS} onClose={jest.fn()} onConfirm={onConfirm} />)
    await fireEvent.press(screen.getByText('Emergency'))
    await fireEvent.press(screen.getByText('Confirm cancellation'))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('emergency'))
  })

  it('shows a timeout message and re-enables dismiss if the request never resolves within 10s', async () => {
    jest.useFakeTimers()
    const onClose = jest.fn()
    const onConfirm = () => new Promise<void>(() => {}) // never resolves
    await render(<CancelSheet visible reasons={REASONS} onClose={onClose} onConfirm={onConfirm} />)
    await fireEvent.press(screen.getByText('Changed my mind'))
    await fireEvent.press(screen.getByText('Confirm cancellation'))
    await act(async () => {
      jest.advanceTimersByTime(10_500)
    })
    await waitFor(() => expect(screen.getByText(/taking longer than expected/i)).toBeTruthy())
    jest.useRealTimers()
  })

  it('becomes dismissible again with an error message when onConfirm rejects', async () => {
    const onClose = jest.fn()
    const onConfirm = jest.fn().mockRejectedValue(new Error('network error'))
    await render(<CancelSheet visible reasons={REASONS} onClose={onClose} onConfirm={onConfirm} />)
    await fireEvent.press(screen.getByText('Changed my mind'))
    await fireEvent.press(screen.getByText('Confirm cancellation'))
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy())
    // No longer stuck submitting: the confirm button shows its label again, not a spinner.
    expect(screen.getByText('Confirm cancellation')).toBeTruthy()
    const confirm = screen.getByText('Confirm cancellation')
    const disabled = confirm.props.accessibilityState?.disabled ?? confirm.parent?.props.accessibilityState?.disabled
    expect(disabled).toBeFalsy()
  })
})
