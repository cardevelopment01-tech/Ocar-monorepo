import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
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
})
