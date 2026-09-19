module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.tsx'],
  moduleNameMapper: {
    '^react-native-reanimated$': '<rootDir>/jest.mocks/react-native-reanimated.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
}
