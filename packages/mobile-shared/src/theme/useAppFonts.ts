import { useFonts } from 'expo-font'
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk'
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans'

// Neither mobile app ever called useFonts() -- every typography.* token's
// fontFamily ('Space Grotesk' / 'Plus Jakarta Sans') was silently falling
// back to the OS default (Roboto / San Francisco) since RN has no error for
// an unregistered font name. Call this once in each app's root _layout.tsx
// and gate the splash screen on its result, same pattern as the existing
// hasHydrated gate.
export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  })
  return loaded
}
