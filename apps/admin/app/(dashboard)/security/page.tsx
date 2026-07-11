'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Copy, Check, Eye, EyeOff, KeyRound } from 'lucide-react'
import { totpApi } from '@/lib/totp-api'

type ViewState = 'loading' | 'idle' | 'enrolling' | 'showing-codes' | 'enabled'

export default function SecurityPage() {
  const [view, setView] = useState<ViewState>('loading')
  const [mandatory, setMandatory] = useState(false)

  const [secret, setSecret] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [codesSavedAck, setCodesSavedAck] = useState(false)
  const [copied, setCopied] = useState(false)

  const [disabling, setDisabling] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [showDisablePassword, setShowDisablePassword] = useState(false)
  const [disableError, setDisableError] = useState<string | null>(null)
  const [disableSubmitting, setDisableSubmitting] = useState(false)

  const load = async () => {
    const status = await totpApi.status()
    setMandatory(status.mandatory)
    setView(status.totpEnabled ? 'enabled' : 'idle')
  }

  useEffect(() => { void load() }, [])

  const startEnroll = async () => {
    const result = await totpApi.setup()
    setSecret(result.secret)
    setQrDataUrl(result.qrDataUrl)
    setConfirmCode('')
    setConfirmError(null)
    setView('enrolling')
  }

  const submitConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setConfirmError(null)
    setConfirming(true)
    try {
      const result = await totpApi.confirm(confirmCode.trim())
      setRecoveryCodes(result.recoveryCodes)
      setCodesSavedAck(false)
      setView('showing-codes')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 422) {
        setConfirmError('No pending setup found — please start again.')
      } else if (status === 401) {
        setConfirmError('Invalid code. Check your authenticator app and try again.')
      } else {
        setConfirmError('Could not confirm setup. Please try again.')
      }
    } finally {
      setConfirming(false)
    }
  }

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const finishEnrollment = () => {
    setView('enabled')
  }

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault()
    setDisableError(null)
    setDisableSubmitting(true)
    try {
      await totpApi.disable(disablePassword)
      setDisablePassword('')
      setDisabling(false)
      setView('idle')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setDisableError(status === 401 ? 'Incorrect password.' : 'Could not disable 2FA. Please try again.')
    } finally {
      setDisableSubmitting(false)
    }
  }

  if (view === 'loading') {
    return <div className="admin-card p-10 text-center text-sm text-text-muted">Loading…</div>
  }

  return (
    <div className="space-y-6 max-w-xl">
      {mandatory && view !== 'enabled' && view !== 'showing-codes' && (
        <div className="bg-warning-light text-warning text-sm font-medium px-4 py-3 rounded-xl flex items-start gap-2">
          <ShieldAlert size={16} className="flex-shrink-0 mt-0.5" />
          Two-factor authentication is required for your role. You won&apos;t be able to use the
          admin panel until it&apos;s enabled.
        </div>
      )}

      {view === 'idle' && (
        <div className="admin-card p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-surface-2 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-text-muted" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Two-factor authentication</h3>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                Not enabled. Add an extra layer of security using an authenticator app
                (Google Authenticator, 1Password, Authy).
              </p>
            </div>
          </div>
          <button
            onClick={() => void startEnroll()}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity cursor-pointer"
          >
            Enable 2FA
          </button>
        </div>
      )}

      {view === 'enrolling' && (
        <div className="admin-card p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-1.5">1. Scan this QR code</h3>
            <p className="text-xs text-text-muted mb-3">Use your authenticator app to scan the code below.</p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="2FA setup QR code" width={200} height={200} className="rounded-xl border border-border" />
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-text-secondary mb-1.5">Can&apos;t scan? Enter manually:</p>
            <code className="block text-xs font-mono bg-surface-2 text-text-primary px-3 py-2 rounded-xl break-all">
              {secret}
            </code>
          </div>

          <form onSubmit={e => void submitConfirm(e)} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                2. Enter the 6-digit code from your app
              </label>
              <input
                value={confirmCode}
                onChange={e => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                className="w-full px-3 py-2 text-sm font-mono tracking-widest border border-border rounded-xl outline-none focus:border-primary transition-colors"
                autoFocus
              />
            </div>

            {confirmError && (
              <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl">
                {confirmError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('idle')}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={confirming || confirmCode.length !== 6}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {confirming ? 'Verifying…' : 'Verify & Enable'}
              </button>
            </div>
          </form>
        </div>
      )}

      {view === 'showing-codes' && (
        <div className="admin-card p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-success-light flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-success" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">2FA is now enabled</h3>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                Save these recovery codes somewhere safe. Each one can be used once to sign in if
                you lose access to your authenticator app. They won&apos;t be shown again.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 bg-surface-2 rounded-xl p-4">
            {recoveryCodes.map(code => (
              <code key={code} className="text-sm font-mono text-text-primary">{code}</code>
            ))}
          </div>

          <button
            onClick={() => void copyRecoveryCodes()}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:opacity-80 transition-opacity cursor-pointer"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy all codes'}
          </button>

          <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={codesSavedAck}
              onChange={e => setCodesSavedAck(e.target.checked)}
              className="mt-0.5"
            />
            I&apos;ve saved these recovery codes somewhere safe
          </label>

          <button
            onClick={finishEnrollment}
            disabled={!codesSavedAck}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Done
          </button>
        </div>
      )}

      {view === 'enabled' && (
        <div className="admin-card p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-success-light flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-success" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Two-factor authentication</h3>
              <p className="text-xs text-text-muted mt-1">Enabled — your account is protected with an authenticator app.</p>
            </div>
          </div>

          {!disabling ? (
            <button
              onClick={() => { setDisabling(true); setDisableError(null); setDisablePassword('') }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-danger border border-border hover:bg-danger-light transition-colors cursor-pointer"
            >
              <KeyRound size={14} />
              Disable 2FA
            </button>
          ) : (
            <form onSubmit={e => void submitDisable(e)} className="space-y-3 max-w-xs">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Confirm your password to disable</label>
                <div className="relative">
                  <input
                    type={showDisablePassword ? 'text' : 'password'}
                    value={disablePassword}
                    onChange={e => setDisablePassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowDisablePassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                  >
                    {showDisablePassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {disableError && (
                <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl">{disableError}</div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDisabling(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disableSubmitting || !disablePassword}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-danger hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {disableSubmitting ? 'Disabling…' : 'Disable'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
