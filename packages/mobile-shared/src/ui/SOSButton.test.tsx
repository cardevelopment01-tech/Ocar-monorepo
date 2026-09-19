import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import { SOSButton, type SOSTriggerResult } from './SOSButton'

describe('SOSButton', () => {
  it('renders nothing when enabled is false', async () => {
    await render(<SOSButton enabled={false} onTrigger={async () => ({ ok: true })} />)
    expect(screen.queryByLabelText('Emergency SOS, double tap to send alert')).toBeNull()
  })

  it('renders the trigger when enabled', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    expect(screen.getByLabelText('Emergency SOS, double tap to send alert')).toBeTruthy()
  })

  it('on success, shows no failure state', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.queryByText(/not sent/i)).toBeNull())
  })

  it('on error, retries once automatically, then shows the persistent failure state', async () => {
    let calls = 0
    const onTrigger = async (): Promise<SOSTriggerResult> => {
      calls++
      return { ok: false, reason: 'error' }
    }
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/SOS not sent/i)).toBeTruthy())
    expect(calls).toBe(2) // one initial attempt + one automatic retry
  })

  it('on rate_limited, does NOT retry and shows the rate-limit message directly', async () => {
    let calls = 0
    const onTrigger = async (): Promise<SOSTriggerResult> => {
      calls++
      return { ok: false, reason: 'rate_limited' }
    }
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/too many/i)).toBeTruthy())
    expect(calls).toBe(1) // no retry against a rate limit
  })

  it('shows the tel: fallback when a phone number is provided and the failure persists', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: false, reason: 'error' })} emergencyPhoneNumber="+911234567890" />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/call emergency/i)).toBeTruthy())
  })

  it('hides the tel: fallback when no phone number is provided', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: false, reason: 'error' })} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/SOS not sent/i)).toBeTruthy())
    expect(screen.queryByText(/call emergency/i)).toBeNull()
  })

  it('does not violate Rules of Hooks when enabled toggles from false to true', async () => {
    const { rerender } = await render(<SOSButton enabled={false} onTrigger={async () => ({ ok: true })} />)
    expect(screen.queryByLabelText('Emergency SOS, double tap to send alert')).toBeNull()
    await expect(rerender(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)).resolves.not.toThrow()
    expect(screen.getByLabelText('Emergency SOS, double tap to send alert')).toBeTruthy()
  })

  it('shows a success confirmation after a successful trigger', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/alert sent/i)).toBeTruthy())
  })

  it('shows a sending indicator while the trigger is in flight', async () => {
    let resolveTrigger: (result: { ok: true }) => void = () => {}
    const onTrigger = () => new Promise<{ ok: true }>((resolve) => { resolveTrigger = resolve })
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    // Not awaited on purpose: onTrigger stays pending until resolveTrigger()
    // fires below, and fireEvent.press awaits whatever the Pressable's
    // onPress handler returns -- awaiting it here would hang forever.
    void fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByTestId('sos-sending-indicator')).toBeTruthy())
    await act(async () => {
      resolveTrigger({ ok: true })
    })
  })
})
