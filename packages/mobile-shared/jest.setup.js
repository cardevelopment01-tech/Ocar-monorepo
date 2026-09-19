// jest setup file for jest-expo + RTL
// jest-expo handles environment setup automatically
jest.mock('react-native-gesture-handler', () => ({}))
jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
}))
