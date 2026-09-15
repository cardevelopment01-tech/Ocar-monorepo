import { Redirect } from 'expo-router'

// Day 1 placeholder — real auth-state check (useAuthStore) lands with the auth screens in days 3-4.
export default function Index() {
  return <Redirect href="/(auth)/phone" />
}
