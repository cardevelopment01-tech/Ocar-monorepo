// Shared bottom-sheet spring — matches components/ui/BottomSheet.tsx, the
// established best-practice sheet. Use this instead of a bespoke one-off
// spring so every sheet in the app opens/closes with the same feel.
export const SHEET_SPRING = { type: 'spring', damping: 32, stiffness: 320 } as const
