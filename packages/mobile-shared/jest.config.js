// packages/mobile-shared/jest.config.js
module.exports = {
  preset: 'jest-expo',
  // Scoped to *.test.tsx only -- *.test.ts (pure logic) stays on the
  // existing vitest.config.ts. Two runners, split by file extension, so
  // neither config has to special-case the other's files.
  testMatch: ['**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^react-native-reanimated$': '<rootDir>/jest.mocks/react-native-reanimated.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
}
