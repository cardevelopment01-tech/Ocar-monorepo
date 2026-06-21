import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, Minus, Plus, User, MapPin, Car } from 'lucide-react'
import { onboardingApi, type PersonalInfoPayload } from '@/lib/onboarding-api'
import { STATE_CITY } from '@/lib/india-geo'
import { useAuthStore } from '@/store/useAuthStore'
import SelectSheet from '@/components/ui/SelectSheet'
import DatePickerSheet from '@/components/ui/DatePickerSheet'

const INDIAN_LANGUAGES = [
  'Hindi', 'English', 'Odia', 'Bengali', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Punjabi',
  'Urdu', 'Assamese', 'Maithili', 'Santali', 'Kashmiri',
  'Nepali', 'Sindhi', 'Dogri', 'Konkani', 'Manipuri', 'Bodo',
]

const VISIBLE_LANGS = 6

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

function Field({ label, id, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2 block"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export default function PersonalDetails() {
  const navigate = useNavigate()
  const updateDriver = useAuthStore(s => s.updateDriver)
  const driver = useAuthStore(s => s.driver)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [showEmail, setShowEmail] = useState(false)
  const [gender, setGender] = useState('')
  const [dob, setDob] = useState('')
  const [address, setAddress] = useState('')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [experience, setExperience] = useState<number | null>(null)
  const [emergency, setEmergency] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [showMoreLangs, setShowMoreLangs] = useState(false)

  const [dobError, setDobError] = useState('')
  const [pincodeError, setPincodeError] = useState('')
  const [emergencyError, setEmergencyError] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // DOB bounds: driver must be 18–70 years old
  const today = new Date()
  const dobMax = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate())
    .toISOString()
    .slice(0, 10)
  const dobMin = new Date(today.getFullYear() - 70, today.getMonth(), today.getDate())
    .toISOString()
    .slice(0, 10)

  useEffect(() => {
    const load = async () => {
      try {
        const saved = await onboardingApi.getPersonalInfo()
        if (saved.full_name)              setFullName(saved.full_name)
        if (saved.email) {
          setEmail(saved.email)
          setShowEmail(true)
        }
        if (saved.gender)                 setGender(saved.gender)
        if (saved.date_of_birth)          setDob(saved.date_of_birth.toString().slice(0, 10))
        if (saved.residential_address)    setAddress(saved.residential_address)
        if (saved.state)                  setState(saved.state)
        if (saved.city)                   setCity(saved.city)
        if (saved.pincode)                setPincode(saved.pincode)
        if (saved.experience_years != null) setExperience(Number(saved.experience_years))
        if (saved.emergency_contact)      setEmergency(saved.emergency_contact.replace(/^\+91/, ''))
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
    setLanguages(prev =>
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    )

  const currentStep = driver?.onboarding_step ?? 'personal_info'
  const steps = ['personal_info', 'vehicle_info', 'documents', 'selfie']
  const stepIdx = steps.indexOf(currentStep)

  const isValid =
    !!fullName.trim() &&
    !!gender &&
    !!dob && dob <= dobMax && dob >= dobMin &&
    !!address.trim() &&
    !!state &&
    !!city &&
    /^\d{6}$/.test(pincode) &&
    experience !== null &&
    /^[6-9]\d{9}$/.test(emergency) &&
    languages.length > 0

  const handleContinue = async () => {
    if (!isValid) return
    setError(null)
    setIsLoading(true)
    try {
      const payload: PersonalInfoPayload = {
        full_name: fullName.trim(),
        gender: gender as PersonalInfoPayload['gender'],
        date_of_birth: dob,
        residential_address: address.trim(),
        state: state.trim(),
        city: city.trim(),
        pincode,
        experience_years: experience ?? 0,
        emergency_contact: formatPhone(emergency),
        languages_known: languages,
      }
      if (email.trim()) payload.email = email.trim()
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

  // City options from selected state
  const cityOptions = STATE_CITY[state] ?? []

  // Language display: always surface selected ones even if they're in the "hidden" set
  const firstSix = INDIAN_LANGUAGES.slice(0, VISIBLE_LANGS)
  const selectedNotInFirst = languages.filter(l => !firstSix.includes(l))
  const displayLanguages: string[] = showMoreLangs
    ? INDIAN_LANGUAGES
    : [...new Set([...firstSix, ...selectedNotInFirst])]

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <>
      {/* Main scrollable content */}
      <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-40">
        {/* Step bar */}
        <div className="flex gap-1.5 mb-8">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`}
            />
          ))}
        </div>

        {/* Back + title */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => navigate(-1)}
            className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <p className="text-text-muted text-xs">Step 1 of 4</p>
            <h1 className="text-xl font-bold">Personal Details</h1>
          </div>
        </div>

        <p className="text-text-muted text-xs mb-5">Progress is saved automatically</p>

        <div className="space-y-4">
          {/* ── Card 1: About you ── */}
          <div className="driver-card">
            <div className="flex items-center gap-2 mb-4">
              <User size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-text-primary">About you</h2>
            </div>
            <div className="space-y-4">
              {/* Full Name */}
              <Field label="Full Name (as on Aadhaar)" id="fullName">
                <input
                  id="fullName"
                  className="input-dark w-full"
                  placeholder="Ramesh Kumar"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                />
              </Field>

              {/* Date of Birth */}
              <Field label="Date of Birth" id="dob">
                <DatePickerSheet
                  label="Date of Birth"
                  value={dob}
                  onChange={v => { setDob(v); setDobError('') }}
                  minDate={dobMin}
                  maxDate={dobMax}
                  placeholder="Select your date of birth"
                />
                {dobError && <p className="text-accent-red text-xs mt-1">{dobError}</p>}
              </Field>

              {/* Gender */}
              <Field label="Gender" id="gender">
                <div className="grid grid-cols-3 gap-2">
                  {(['male', 'female', 'other'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      aria-pressed={gender === g}
                      className={`py-3 min-h-[44px] rounded-xl border-2 font-semibold text-sm capitalize transition-all flex items-center justify-center gap-1.5 ${
                        gender === g
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border text-text-secondary bg-surface-2'
                      }`}
                    >
                      {gender === g && <Check size={14} strokeWidth={2.5} />}
                      {g === 'other' ? 'Other' : g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          {/* ── Card 2: Where you live ── */}
          <div className="driver-card">
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-text-primary">Where you live</h2>
            </div>
            <div className="space-y-4">
              {/* Residential Address */}
              <Field label="Residential Address" id="address">
                <textarea
                  id="address"
                  className="input-dark w-full resize-none"
                  rows={2}
                  placeholder="House No, Street, Locality"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                />
              </Field>

              {/* State */}
              <Field label="State" id="state">
                <div className="relative">
                  <SelectSheet
                    label="Select State"
                    value={state}
                    options={Object.keys(STATE_CITY)}
                    onChange={v => { setState(v); setCity('') }}
                    placeholder="Select state"
                    searchable
                  />
                </div>
              </Field>

              {/* City — bottom-sheet picker or free-text fallback for single-city UTs */}
              <Field label="City" id="city">
                {!state ? (
                  <button
                    type="button"
                    disabled
                    className="input-dark w-full flex items-center justify-between gap-2 opacity-50 cursor-not-allowed"
                    style={{ minHeight: 52 }}
                  >
                    <span className="text-text-muted font-normal">Select state first</span>
                    <ChevronDown size={18} className="text-text-muted flex-shrink-0" />
                  </button>
                ) : cityOptions.length >= 2 ? (
                  <SelectSheet
                    label="Select City"
                    value={city}
                    options={cityOptions}
                    onChange={setCity}
                    placeholder="Select city"
                  />
                ) : (
                  <input
                    id="city"
                    className="input-dark w-full"
                    placeholder={cityOptions[0] ?? 'Enter city'}
                    value={city}
                    onChange={e => setCity(e.target.value)}
                  />
                )}
              </Field>

              {/* Pincode */}
              <Field label="Pincode" id="pincode">
                <input
                  id="pincode"
                  className="input-dark w-full"
                  placeholder="751001"
                  maxLength={6}
                  inputMode="numeric"
                  value={pincode}
                  onChange={e => {
                    setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setPincodeError('')
                  }}
                  onBlur={() => {
                    if (pincode && !/^\d{6}$/.test(pincode)) {
                      setPincodeError('Enter a valid 6-digit pincode')
                    } else {
                      setPincodeError('')
                    }
                  }}
                />
                {pincodeError && <p className="text-accent-red text-xs mt-1">{pincodeError}</p>}
              </Field>
            </div>
          </div>

          {/* ── Card 3: Driving & contact ── */}
          <div className="driver-card">
            <div className="flex items-center gap-2 mb-4">
              <Car size={16} className="text-primary" />
              <h2 className="text-sm font-bold text-text-primary">Driving &amp; contact</h2>
            </div>
            <div className="space-y-4">
              {/* Experience stepper */}
              <Field label="Driving Experience" id="experience">
                <div
                  role="group"
                  aria-label="Driving experience in years"
                  className="flex items-center justify-between bg-surface-2 border border-border rounded-xl h-[52px] px-2 gap-1"
                >
                  <button
                    type="button"
                    onClick={() => setExperience(v => Math.max(0, (v ?? 0) - 1))}
                    disabled={experience !== null && experience <= 0}
                    aria-label="Decrease years"
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-white border border-border text-primary active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100 flex-shrink-0"
                  >
                    <Minus size={16} />
                  </button>
                  <div className="flex-1 text-center">
                    {experience === null ? (
                      <span className="text-text-muted text-sm font-medium">Tap to set</span>
                    ) : (
                      <span className="font-bold text-base text-text-primary tabular-nums">
                        {experience} {experience === 1 ? 'yr' : 'yrs'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExperience(v => Math.min(40, (v ?? 0) + 1))}
                    disabled={experience !== null && experience >= 40}
                    aria-label="Increase years"
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-white border border-border text-primary active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100 flex-shrink-0"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </Field>

              {/* Languages Known */}
              <Field label="Languages Known" id="languages">
                <div className="flex flex-wrap gap-2">
                  {displayLanguages.map(lang => (
                    <button
                      key={lang}
                      onClick={() => toggleLanguage(lang)}
                      aria-pressed={languages.includes(lang)}
                      className={`px-4 py-2.5 min-h-[44px] rounded-full border text-xs font-semibold transition-all flex items-center gap-1.5 ${
                        languages.includes(lang)
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border text-text-secondary bg-surface-2'
                      }`}
                    >
                      {languages.includes(lang) && <Check size={12} strokeWidth={2.5} />}
                      {lang}
                    </button>
                  ))}
                  {!showMoreLangs && INDIAN_LANGUAGES.length > VISIBLE_LANGS && (
                    <button
                      onClick={() => setShowMoreLangs(true)}
                      className="px-4 py-2.5 min-h-[44px] rounded-full border border-dashed border-border text-xs font-semibold text-primary bg-primary/5 transition-all"
                    >
                      +{INDIAN_LANGUAGES.length - VISIBLE_LANGS} more
                    </button>
                  )}
                </div>
              </Field>

              {/* Emergency Contact */}
              <Field label="Emergency Contact" id="emergency">
                <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-4 h-[52px] focus-within:border-primary transition-colors">
                  <span className="text-text-secondary font-semibold text-sm flex-shrink-0">+91</span>
                  <div className="w-px h-5 bg-border" />
                  <input
                    id="emergency"
                    className="flex-1 bg-transparent text-text-primary font-semibold text-sm outline-none placeholder:text-text-muted"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Family member's number"
                    value={emergency}
                    onChange={e => {
                      setEmergency(e.target.value.replace(/\D/g, '').slice(0, 10))
                      setEmergencyError('')
                    }}
                    onBlur={() => {
                      if (emergency && !/^[6-9]\d{9}$/.test(emergency)) {
                        setEmergencyError('Enter a valid 10-digit Indian mobile number')
                      } else {
                        setEmergencyError('')
                      }
                    }}
                  />
                </div>
                {emergencyError
                  ? <p className="text-accent-red text-xs mt-1">{emergencyError}</p>
                  : <p className="text-text-muted text-xs mt-1.5">Only contacted in a safety emergency · never shared with riders</p>
                }
              </Field>

              {/* Email — collapsed optional field */}
              {!showEmail ? (
                <button
                  type="button"
                  onClick={() => setShowEmail(true)}
                  className="flex items-center gap-1.5 text-primary text-sm font-semibold py-1 min-h-[44px]"
                >
                  <Plus size={15} />
                  Add email address (optional)
                </button>
              ) : (
                <Field label="Email Address" id="email">
                  <input
                    id="email"
                    className="input-dark w-full"
                    type="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoFocus
                  />
                </Field>
              )}
            </div>
          </div>
        </div>

        {error && <p className="text-accent-red text-sm mt-4">{error}</p>}
      </div>

      {/* Sticky footer CTA */}
      <div className="fixed bottom-0 left-0 right-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-sm border-t border-border z-20">
        {!isValid && (
          <p className="text-text-muted text-xs text-center mb-2">
            {!fullName.trim() ? 'Enter your full name to continue'
              : !gender ? 'Select your gender to continue'
              : !dob ? 'Enter your date of birth to continue'
              : !!dob && (dob > dobMax || dob < dobMin) ? 'Driver must be 18–70 years old'
              : !address.trim() ? 'Enter your residential address'
              : !state ? 'Select your state'
              : !city ? 'Select your city'
              : !/^\d{6}$/.test(pincode) ? 'Enter a valid 6-digit pincode'
              : experience === null ? 'Set your driving experience'
              : !/^[6-9]\d{9}$/.test(emergency) ? 'Enter a valid emergency contact number'
              : languages.length === 0 ? 'Select at least one language'
              : ''}
          </p>
        )}
        <button
          onClick={handleContinue}
          disabled={!isValid || isLoading}
          className="btn-go w-full"
          style={{ minHeight: 52 }}
        >
          {isLoading
            ? <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Saving…
              </span>
            : 'Continue'}
        </button>
      </div>
    </>
  )
}
