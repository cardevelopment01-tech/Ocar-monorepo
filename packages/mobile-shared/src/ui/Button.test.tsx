import { render, screen, fireEvent } from '@testing-library/react-native'
import { Button } from './Button'

describe('Button (harness smoke test)', () => {
  it('renders its label and calls onPress', async () => {
    const onPress = jest.fn()
    await render(<Button label="Go online" onPress={onPress} />)
    expect(screen.getByText('Go online')).toBeTruthy()
    await fireEvent.press(screen.getByText('Go online'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn()
    await render(<Button label="Go online" onPress={onPress} disabled />)
    await fireEvent.press(screen.getByText('Go online'))
    expect(onPress).not.toHaveBeenCalled()
  })
})
