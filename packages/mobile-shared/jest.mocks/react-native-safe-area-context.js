// Minimal self-contained mock: CancelSheet only needs useSafeAreaInsets() to
// return a plausible insets object. The package's own jest/mock.tsx pulls in
// jest.requireActual() context wiring that doesn't resolve cleanly through
// this project's moduleNameMapper interception, so we keep this simple.
const insets = { top: 0, right: 0, bottom: 0, left: 0 }

module.exports = {
  __esModule: true,
  useSafeAreaInsets: () => insets,
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
  SafeAreaProvider: ({ children }) => children,
  SafeAreaInsetsContext: { Provider: ({ children }) => children },
  SafeAreaFrameContext: { Provider: ({ children }) => children },
  initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 320, height: 640 } },
}
