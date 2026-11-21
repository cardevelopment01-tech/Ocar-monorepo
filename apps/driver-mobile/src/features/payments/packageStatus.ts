// What a package-billing driver should be told about their ride credit, as pure rules (unit-tested). The server decides who gets
// ride offers (a balance above zero); this only words the state so the driver is never left wondering why requests stopped.

export type PackageLot = { remaining: string; expires_at: string }

export type PackageState = 'active' | 'low' | 'empty' | 'overdrawn' | 'frozen'

export type PackageStatus = {
  state: PackageState
  /** Short chip text on the balance card. */
  chip: string
  /** A banner under the balance card, or null when nothing needs saying. */
  notice: { tone: 'warn' | 'error' | 'info'; title: string; message: string } | null
  /** Credit that expires within EXPIRY_WARN_DAYS, soonest first. */
  expiringSoon: { amount: number; expiresAt: string; daysLeft: number } | null
}

/** Credit left at which a driver is told to top up before the next ride drains it. */
export const LOW_CREDIT = 100
export const EXPIRY_WARN_DAYS = 30

const DAY_MS = 86_400_000
const rupees = (n: number) => Math.round(Math.abs(n)).toLocaleString('en-IN')

export function daysLeft(expiresAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS))
}

export function packageStatus(input: { balance: number; frozen: boolean; lots: readonly PackageLot[]; now?: Date }): PackageStatus {
  const now = input.now ?? new Date()
  const soon = input.lots
    .map((l) => ({ amount: parseFloat(l.remaining), expiresAt: l.expires_at, daysLeft: daysLeft(l.expires_at, now) }))
    .filter((l) => l.amount > 0 && l.daysLeft <= EXPIRY_WARN_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null

  if (input.frozen) {
    return { state: 'frozen', chip: 'On hold', expiringSoon: soon, notice: { tone: 'error', title: 'Your ride credit is on hold', message: 'You will not receive ride requests until support releases it. Please contact support.' } }
  }
  if (input.balance < 0) {
    return {
      state: 'overdrawn', chip: 'Recharge needed', expiringSoon: soon,
      notice: { tone: 'error', title: `You are ₹${rupees(input.balance)} short`, message: `Your last ride cost more than the credit you had left. Recharge to clear the ₹${rupees(input.balance)}, and add more to start receiving ride requests again.` },
    }
  }
  if (input.balance === 0) {
    return { state: 'empty', chip: 'No credit', expiringSoon: soon, notice: { tone: 'error', title: 'No ride credit left', message: 'You will not receive ride requests until you add credit. Choose a plan below.' } }
  }
  if (input.balance < LOW_CREDIT) {
    return { state: 'low', chip: 'Running low', expiringSoon: soon, notice: { tone: 'warn', title: 'Your credit is running low', message: `Only ₹${rupees(input.balance)} left. Add credit so a longer ride does not use it all up and pause your requests.` } }
  }
  if (soon) {
    return {
      state: 'active', chip: 'Active', expiringSoon: soon,
      notice: { tone: 'info', title: `₹${rupees(soon.amount)} expires in ${soon.daysLeft} ${soon.daysLeft === 1 ? 'day' : 'days'}`, message: 'Credit not used by then lapses and is not refunded. Your newer purchases are unaffected.' },
    }
  }
  return { state: 'active', chip: 'Active', notice: null, expiringSoon: null }
}

/** One activity line for the package ledger. */
export function ledgerLine(e: { entry_type: string; amount: string; direction: 'credit' | 'debit'; ride_id: string | null; note: string | null }): { title: string; subtitle: string | null; sign: '+' | '−' } {
  const sign = e.direction === 'credit' ? '+' : '−'
  switch (e.entry_type) {
    case 'topup': return { title: 'Ride credit added', subtitle: null, sign }
    case 'ride_consumption': return { title: e.ride_id ? `Ride #${e.ride_id}` : 'Ride fare', subtitle: 'Used from your credit', sign }
    case 'expiry': return { title: 'Credit expired', subtitle: e.note ?? 'Unused credit from an older purchase', sign }
    case 'admin_adjustment': return { title: e.direction === 'credit' ? 'Credit added by Ocar' : 'Adjustment by Ocar', subtitle: e.note, sign }
    default: return { title: e.entry_type.replace(/_/g, ' '), subtitle: e.note, sign }
  }
}
