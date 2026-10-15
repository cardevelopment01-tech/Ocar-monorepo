import type { WalletGate } from './useWalletGate'

const rupees = (n: number) => Math.round(Math.abs(n)).toLocaleString('en-IN')

/** What to tell a driver whose wallet blocks going online (not frozen: that has its own message). Null when not blocked. */
export function walletBlockMessage(g: Pick<WalletGate, 'isFrozen' | 'canGoOnline' | 'duesOwed' | 'minBalance'>): { title: string; message: string } | null {
  if (g.isFrozen || g.canGoOnline) return null
  if (g.duesOwed !== null) return { title: 'Dues owed', message: `You owe ₹${rupees(g.duesOwed)}. Pay it from your wallet to go online.` }
  return { title: 'Low wallet balance', message: `Your wallet needs at least ₹${rupees(g.minBalance ?? 0)} to go online and receive requests. Top up to continue.` }
}
