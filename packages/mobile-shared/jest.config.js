module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.tsx'],
  moduleNameMapper: {
    '^react-native-reanimated$': '<rootDir>/jest.mocks/react-native-reanimated.js',
    '^react-native-safe-area-context$': '<rootDir>/jest.mocks/react-native-safe-area-context.js',
  },
  // pnpm's default layout puts every dependency under node_modules/.pnpm/<name>@<version>/node_modules/<name>,
  // so the allow-list has to tolerate that extra `.pnpm/` segment before the package name.
  transformIgnorePatterns: [
    'node_modules/(?!(?:\.pnpm/)?(?:(?:jest-)?react-native|@react-native(?:-community)?|expo(?:nent)?|@expo(?:nent)?[/+].*|@expo-google-fonts[/+].*|react-navigation|@react-navigation[/+].*|@unimodules[/+].*|unimodules|sentry-expo|native-base|react-native-svg|react-native-safe-area-context))',
  ],
}
