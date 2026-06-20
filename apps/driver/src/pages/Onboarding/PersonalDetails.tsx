import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { onboardingApi, type PersonalInfoPayload } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

const INDIAN_LANGUAGES = ['Hindi', 'English', 'Odia', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Punjabi']

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

export default function PersonalDetails() {
  const navigate = useNavigate()
  const updateDriver = useAuthStore(s => s.updateDriver)
  const driver = useAuthStore(s => s.driver)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [gender, setGender] = useState('')
  const [dob, setDob] = useState('')
  const [address, setAddress] = useState('')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [experience, setExperience] = useState('')
  const [emergency, setEmergency] = useState('')
  const [languages, setLanguages] = useState<string[]>([])

  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await onboardingApi.getPersonalInfo()
        if (saved.full_name)          setFullName(saved.full_name)
        if (saved.email)              setEmail(saved.email)
        if (saved.gender)             setGender(saved.gender)
        if (saved.date_of_birth)      setDob(saved.date_of_birth.toString().slice(0, 10))
        if (saved.residential_address) setAddress(saved.residential_address)
        if (saved.state)              setState(saved.state)
        if (saved.city)               setCity(saved.city)
        if (saved.pincode)            setPincode(saved.pincode)
        if (saved.experience_years != null) setExperience(String(saved.experience_years))
        if (saved.emergency_contact)  setEmergency(saved.emergency_contact.replace(/^\+91/, ''))
        if (saved.languages_known?.length) setLanguages(saved.languages_known)
      } catch {
        // First-time user — no saved data
      } finally {
        setIsFetching(false)
      }
    }
    void load()
  }, [])

  const toggleLanguage = (lang: string) =>
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])

  const currentStep = driver?.onboarding_step ?? 'personal_info'
  const steps = ['personal_info', 'vehicle_info', 'documents', 'selfie']
  const stepIdx = steps.indexOf(currentStep)

  const isValid =
    !!fullName &&
    !!gender &&
    !!dob &&
    !!address &&
    !!state &&
    !!city &&
    /^\d{6}$/.test(pincode) &&
    !!experience &&
    /^[6-9]\d{9}$/.test(emergency) &&
    languages.length > 0

  const handleContinue = async () => {
    if (!isValid) return
    setError(null)
    setIsLoading(true)
    try {
      const payload: PersonalInfoPayload = {
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        gender: gender as PersonalInfoPayload['gender'],
        date_of_birth: dob,
        residential_address: address.trim(),
        state: state.trim(),
        city: city.trim(),
        pincode,
        experience_years: parseInt(experience, 10),
        emergency_contact: formatPhone(emergency),
        languages_known: languages,
      }
      const result = await onboardingApi.savePersonalInfo(payload)
      updateDriver({ onboarding_step: result.next_step })
      navigate('/onboarding/vehicle')
    } catch (err: unknown) {
      const apiError = (err as { response?: { data?: { code?: string } } })?.response?.data
      if ((apiError as { code?: string })?.code === 'VALIDATION_ERROR') {
        setError('Please check your details and try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10">
      {/* Step bar */}
      <div className="flex gap-1.5 mb-8">
        {steps.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 1 of 4</p>
          <h1 className="text-xl font-bold">Personal Details</h1>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {/* Full Name */}
        <Field label="Full Name (as on Aadhaar)">
          <input className="input-dark w-full" placeholder="Ramesh Kumar" value={fullName}
            onChange={e => setFullName(e.target.value)} />
        </Field>

        {/* Date of birth */}
        <Field label="Date of Birth">
          <input className="input-dark w-full" type="date" value={dob}
            onChange={e => setDob(e.target.value)} />
        </Field>

        {/* Gender */}
        <Field label="Gender">
          <div className="grid grid-cols-3 gap-2">
            {(['male', 'female', 'other'] as const).map(g => (
              <button key={g} onClick={() => setGender(g)}
                className={`py-3 min-h-[44px] rounded-xl border-2 font-semibold text-sm capitalize transition-all ${gender === g ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                {g === 'other' ? 'Other' : g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </Field>

        {/* Email */}
        <Field label="Email (optional)">
          <input className="input-dark w-full" type="email" placeholder="you@email.com" value={email}
            onChange={e => setEmail(e.target.value)} />
        </Field>

        {/* Address */}
        <Field label="Residential Address">
          <textarea className="input-dark w-full resize-none" rows={2} placeholder="House No, Street, Locality"
            value={address} onChange={e => setAddress(e.target.value)} />
        </Field>

        {/* State + City */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <input className="input-dark w-full" placeholder="Odisha" value={state}
              onChange={e => setState(e.target.value)} />
          </Field>
          <Field label="City">
            <input className="input-dark w-full" placeholder="Bhubaneswar" value={city}
              onChange={e => setCity(e.target.value)} />
          </Field>
        </div>

        {/* Pincode + Experience */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pincode">
            <input className="input-dark w-full" placeholder="751001" maxLength={6} inputMode="numeric"
              value={pincode} onChange={e => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </Field>
          <Field label="Driving Experience (yrs)">
            <input className="input-dark w-full" placeholder="3" inputMode="numeric"
              value={experience} onChange={e => setExperience(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>

        {/* Emergency contact */}
        <Field label="Emergency Contact">
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-4 h-[52px] focus-within:border-primary transition-colors">
            <span className="text-text-secondary font-semibold text-sm flex-shrink-0">+91</span>
            <div className="w-px h-5 bg-border" />
            <input className="flex-1 bg-transparent text-text-primary font-semibold text-sm outline-none placeholder:text-text-muted"
              type="tel" inputMode="numeric" maxLength={10} placeholder="Family member's number"
              value={emergency} onChange={e => setEmergency(e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </div>
        </Field>

        {/* Languages */}
        <Field label="Languages Known (select at least one)">
          <div className="flex flex-wrap gap-2">
            {INDIAN_LANGUAGES.map(lang => (
              <button key={lang} onClick={() => toggleLanguage(lang)}
                className={`px-4 py-2.5 min-h-[44px] rounded-full border text-xs font-semibold transition-all ${languages.includes(lang) ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                {lang}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {error && <p className="text-accent-red text-sm mb-4">{error}</p>}

      <button onClick={handleContinue} disabled={!isValid || isLoading}
        className="btn-go w-full" style={{ minHeight: 56 }}>
        {isLoading
          ? <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Saving…
            </span>
          : 'Continue'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2 block">{label}</label>
      {children}
    </div>
  )
}
