import { render, screen, fireEvent } from '@testing-library/react-native'
import { Button } from './Button'

describe('Button (harness smoke test)', () => {
  it('renders its label and calls onPress', () => {
    const onPress = jest.fn()
    render(<Button label="Go online" onPress={onPress} />)
    expect(screen.getByText('Go online')).toBeTruthy()
    fireEvent.press(screen.getByText('Go online'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn()
    render(<Button label="Go online" onPress={onPress} disabled />)
    fireEvent.press(screen.getByText('Go online'))
    expect(onPress).not.toHaveBeenCalled()
  })
})
