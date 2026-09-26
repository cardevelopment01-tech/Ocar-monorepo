import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import { SOSButton, type SOSTriggerResult } from './SOSButton'

const OPEN = 'Emergency SOS, double tap for safety options'
const HOLD = 'Send SOS alert, press and hold'

async function openSheet() {
  await fireEvent.press(screen.getByLabelText(OPEN))
}

// The alert is sent by a long press, never by a single tap.
async function hold() {
  await fireEvent(screen.getByLabelText(HOLD), 'longPress')
}

describe('SOSButton', () => {
  it('renders nothing when enabled is false', async () => {
    await render(<SOSButton enabled={false} onTrigger={async () => ({ ok: true })} />)
    expect(screen.queryByLabelText(OPEN)).toBeNull()
  })

  it('renders the trigger when enabled', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    expect(screen.getByLabelText(OPEN)).toBeTruthy()
  })

  it('a single tap opens the sheet and does not send an alert', async () => {
    const onTrigger = jest.fn(async (): Promise<SOSTriggerResult> => ({ ok: true }))
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await openSheet()
    expect(screen.getByLabelText(HOLD)).toBeTruthy()
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('always offers the emergency call, defaulting to 112', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    await openSheet()
    expect(screen.getByLabelText('Call 112')).toBeTruthy()
  })

  it('uses a custom emergency number when provided', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} emergencyPhoneNumber="100" />)
    await openSheet()
    expect(screen.getByLabelText('Call 100')).toBeTruthy()
  })

  it('holding sends the alert and shows the confirmation', async () => {
    const onTrigger = jest.fn(async (): Promise<SOSTriggerResult> => ({ ok: true }))
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await openSheet()
    await hold()
    await waitFor(() => expect(screen.getByText('Alert sent')).toBeTruthy())
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('on error, retries once automatically, then shows the failure state', async () => {
    let calls = 0
    const onTrigger = async (): Promise<SOSTriggerResult> => {
      calls++
      return { ok: false, reason: 'error' }
    }
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await openSheet()
    await hold()
    await waitFor(() => expect(screen.getByText(/was not sent/i)).toBeTruthy())
    expect(calls).toBe(2) // one initial attempt + one automatic retry
  })

  it('on rate_limited, does not retry and shows the rate-limit message', async () => {
    let calls = 0
    const onTrigger = async (): Promise<SOSTriggerResult> => {
      calls++
      return { ok: false, reason: 'rate_limited' }
    }
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await openSheet()
    await hold()
    await waitFor(() => expect(screen.getByText(/too many/i)).toBeTruthy())
    expect(calls).toBe(1)
  })

  it('does not violate Rules of Hooks when enabled toggles from false to true', async () => {
    const { rerender } = await render(<SOSButton enabled={false} onTrigger={async () => ({ ok: true })} />)
    expect(screen.queryByLabelText(OPEN)).toBeNull()
    await expect(rerender(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)).resolves.not.toThrow()
    expect(screen.getByLabelText(OPEN)).toBeTruthy()
  })

  it('shows a sending indicator while the trigger is in flight', async () => {
    let resolveTrigger: (result: { ok: true }) => void = () => {}
    const onTrigger = () => new Promise<{ ok: true }>((resolve) => { resolveTrigger = resolve })
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await openSheet()
    // Not awaited: onTrigger stays pending until resolveTrigger() fires below.
    void fireEvent(screen.getByLabelText(HOLD), 'longPress')
    await waitFor(() => expect(screen.getByTestId('sos-sending-indicator')).toBeTruthy())
    await act(async () => {
      resolveTrigger({ ok: true })
    })
  })
})
