import { useState } from 'react'
import { driverPayoutApi, type DriverBankAccount } from '@/lib/ride-api'

function maskIfsc(ifsc: string): string {
  return `****${ifsc.slice(-4)}`
}

function statusLabel(status: DriverBankAccount['status']): string {
  switch (status) {
    case 'verified':             return 'Verified'
    case 'pending_verification': return 'Pending verification'
    case 'invalid':              return 'Invalid — please re-add'
    default:                     return status
  }
}

export default function BankAccountSection({
  account,
  onAdded,
}: {
  account: DriverBankAccount | null
  onAdded: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [accountHolderName, setAccountHolderName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValid =
    accountHolderName.trim().length > 0 &&
    /^\d{9,18}$/.test(accountNumber) &&
    /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)

  async function handleSubmit() {
    if (!isValid) return
    setSaving(true)
    setError(null)
    try {
      const params: { accountHolderName: string; accountNumber: string; ifsc: string; upiVpa?: string } = {
        accountHolderName: accountHolderName.trim(),
        accountNumber,
        ifsc,
      }
      if (upiVpa.trim()) params.upiVpa = upiVpa.trim()
      await driverPayoutApi.addBankAccount(params)
      setShowForm(false)
      setAccountHolderName('')
      setAccountNumber('')
      setIfsc('')
      setUpiVpa('')
      onAdded()
    } catch {
      setError('Could not add bank account. Please check the details and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (account && !showForm) {
    return (
      <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-primary text-sm font-bold mb-1">Bank Account</p>
        <p className="text-text-secondary text-sm">
          {account.account_holder_name} · IFSC {maskIfsc(account.ifsc)}
        </p>
        <p className={
          account.status === 'verified'
            ? 'text-accent-green text-xs font-semibold mt-1'
            : 'text-accent-amber text-xs font-semibold mt-1'
        }>
          {statusLabel(account.status)}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border">
      <p className="text-text-primary text-sm font-bold mb-3">Add Bank Account</p>
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="rounded-2xl px-4 py-3 text-sm font-bold text-white bg-primary w-full cursor-pointer"
        >
          Add Bank Account
        </button>
      ) : (
        <div className="space-y-3">
          <input
            className="input-dark w-full"
            placeholder="Account holder name"
            value={accountHolderName}
            onChange={e => setAccountHolderName(e.target.value)}
          />
          <input
            className="input-dark w-full"
            placeholder="Account number"
            inputMode="numeric"
            value={accountNumber}
            onChange={e => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
          />
          <input
            className="input-dark w-full uppercase"
            placeholder="IFSC (e.g. SBIN0001234)"
            maxLength={11}
            value={ifsc}
            onChange={e => setIfsc(e.target.value.toUpperCase().slice(0, 11))}
          />
          <input
            className="input-dark w-full"
            placeholder="UPI ID (optional)"
            value={upiVpa}
            onChange={e => setUpiVpa(e.target.value)}
          />
          {error && <p className="text-accent-red text-xs">{error}</p>}
          <button
            onClick={() => void handleSubmit()}
            disabled={!isValid || saving}
            className="rounded-2xl px-4 py-3 text-sm font-bold text-white bg-primary w-full disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving…' : 'Save Bank Account'}
          </button>
        </div>
      )}
    </div>
  )
}
