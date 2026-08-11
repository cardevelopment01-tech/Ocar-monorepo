import { useState, useEffect } from 'react'
import { RefreshCw, Minus, Plus, Check } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import DatePickerSheet from '@/components/ui/DatePickerSheet'
import SettingsHeader from '@/components/settings/SettingsHeader'
import { onboardingApi, type VehicleInfoPayload, type VehicleCategory, type VehicleBrand, type VehicleModel } from '@/lib/onboarding-api'
import InlineSelect from '@/components/ui/InlineSelect'
import FieldError, { ShakeWrap, useShake } from '@/components/ui/FieldError'

const TODAY_ISO = new Date().toISOString().slice(0, 10)
const MIN_MODEL_YEAR = 1990
const MAX_MODEL_YEAR = new Date().getFullYear() + 1

const COLORS = ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Green', 'Yellow', 'Orange', 'Other'] as const
const FUEL_TYPES = [
  { value: 'petrol',   label: 'Petrol' },
  { value: 'diesel',   label: 'Diesel' },
  { value: 'cng',      label: 'CNG'    },
  { value: 'electric', label: 'EV'     },
] as const

const CATEGORY_FALLBACK_NOTE: Record<string, string> = {
  sedan: 'Sedan drivers also receive Hatchback requests when Hatchbacks are scarce nearby, paid at Hatchback fare.',
  suv:   'SUV drivers also receive Sedan requests when Sedans are scarce nearby, paid at Sedan fare.',
}

// Flat settings screen for an already-approved driver's vehicle record.
// Not a step in a sequence: no stepper, no "Continue", saves in place.
export default function VehicleDetails() {
  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [brands, setBrands] = useState<VehicleBrand[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [loadError, setLoadError] = useState(false)

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [modelId, setModelId] = useState<number | null>(null)
  const [modelYear, setModelYear] = useState('')
  const [registrationDate, setRegistrationDate] = useState('')
  const [plate, setPlate] = useState('')
  const [color, setColor] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [seating, setSeating] = useState(4)
  const [luggage, setLuggage] = useState(2)
  const [ac, setAc] = useState(true)

  const [plateError, setPlateError] = useState('')
  const [yearError, setYearError] = useState('')
  const plateShake = useShake()
  const yearShake = useShake()
  const [isSaving, setIsSaving] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const loadDropdownData = async () => {
    setLoadError(false)
    setIsFetching(true)
    try {
      const [cats, brs, savedVehicle] = await Promise.all([
        onboardingApi.getCategories(),
        onboardingApi.getBrands(),
        onboardingApi.getVehicleInfo(),
      ])
      setCategories(cats)
      setBrands(brs)

      if (savedVehicle?.vehicle) {
        const v = savedVehicle.vehicle
        if (v.category_id) setCategoryId(Number(v.category_id))
        if (v.brand_id) {
          setBrandId(Number(v.brand_id))
          const m = await onboardingApi.getModels(Number(v.brand_id))
          setModels(m)
        }
        if (v.model_id) setModelId(Number(v.model_id))
        if (v.model_year)        setModelYear(String(v.model_year))
        if (v.registration_date) setRegistrationDate(String(v.registration_date).slice(0, 10))
        if (v.number_plate) setPlate(v.number_plate)
        if (v.color)        setColor(v.color)
        if (v.fuel_type)    setFuelType(v.fuel_type)
        if (v.seating_capacity) setSeating(v.seating_capacity)
        if (v.luggage_capacity != null) setLuggage(v.luggage_capacity)
        if (v.ac_availability != null) setAc(v.ac_availability)
      }
    } catch {
      setLoadError(true)
    } finally {
      setIsFetching(false)
    }
  }

  useEffect(() => { void loadDropdownData() }, [])

  const handleBrandChange = async (id: number) => {
    setBrandId(id)
    setModelId(null)
    setModels([])
    try {
      const m = await onboardingApi.getModels(id)
      setModels(m)
    } catch { /* ignore */ }
  }

  const handleModelChange = (id: number) => {
    setModelId(id)
    const model = models.find(m => Number(m.id) === id)
    if (model?.typical_category_id) setCategoryId(Number(model.typical_category_id))
  }

  const isValidPlate = (p: string) =>
    /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(p.replace(/\s/g, '').toUpperCase())

  const isValidYear = (y: string) =>
    y.length === 4 && Number(y) >= MIN_MODEL_YEAR && Number(y) <= MAX_MODEL_YEAR

  const selectedModel = models.find(m => Number(m.id) === modelId)
  const isValid = categoryId && brandId && modelId && selectedModel && modelYear && isValidYear(modelYear) && plate && isValidPlate(plate) && color && fuelType

  const handleSave = async () => {
    if (!isValid) return
    setPlateError('')
    setError(null)
    setSaved(false)
    setIsSaving(true)
    try {
      const payload: VehicleInfoPayload = {
        category_id: Number(categoryId),
        brand_id: Number(brandId),
        model_id: Number(modelId),
        vehicle_name: selectedModel!.name,
        model_year: parseInt(modelYear, 10),
        number_plate: plate.trim().toUpperCase().replace(/\s/g, ''),
        color,
        fuel_type: fuelType as VehicleInfoPayload['fuel_type'],
        seating_capacity: seating,
        luggage_capacity: luggage,
        ac_availability: ac,
      }
      if (registrationDate) payload.registration_date = registrationDate
      await onboardingApi.saveVehicleInfo(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { code?: string; fields?: Record<string, string[]> } } })?.response?.data
      if (apiErr?.code === 'DUPLICATE_ENTRY') {
        setPlateError('This number plate is already registered. Contact support if this is your vehicle.')
      } else if (apiErr?.code === 'VALIDATION_ERROR') {
        if (apiErr.fields?.number_plate) setPlateError(apiErr.fields.number_plate[0] ?? 'Invalid plate')
        else setError('Please check your vehicle details.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (isFetching) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <OcarSpinner size={32} variant="color" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4 px-5">
        <p className="text-text-secondary text-sm text-center">Failed to load vehicle data.</p>
        <button onClick={() => void loadDropdownData()} className="flex items-center gap-2 text-primary font-semibold text-sm">
          <RefreshCw size={16} /> Tap to retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-bg text-text-primary">
      <SettingsHeader title="Vehicle Details" subtitle="Registered vehicle" />

      <main className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
        <div className="space-y-4">
          {/* Brand */}
          <Field label="Brand">
            <InlineSelect
              value={brandId}
              options={brands.map(b => ({ value: Number(b.id), label: b.name }))}
              onChange={v => void handleBrandChange(Number(v))}
              placeholder="Select brand"
              searchable={brands.length > 6}
            />
          </Field>

          {/* Model */}
          <Field label="Model">
            <InlineSelect
              value={modelId}
              options={models.map(m => ({ value: Number(m.id), label: m.name }))}
              onChange={v => handleModelChange(Number(v))}
              placeholder={!brandId ? 'Select brand first' : 'Select model'}
              disabled={!brandId}
              loading={!!brandId && models.length === 0 && !loadError}
              searchable={models.length > 6}
            />
          </Field>

          {/* Category */}
          <Field label="Vehicle Category">
            <div className="grid grid-cols-2 gap-2">
              {categories.map(c => (
                <button key={c.id} onClick={() => setCategoryId(Number(c.id))}
                  className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${categoryId === Number(c.id) ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                  {c.display_name}
                </button>
              ))}
            </div>
            {(() => {
              const slug = categories.find(c => Number(c.id) === categoryId)?.slug
              const note = slug ? CATEGORY_FALLBACK_NOTE[slug] : undefined
              return note ? <p className="text-text-muted text-xs mt-2">{note}</p> : null
            })()}
          </Field>

          {/* Number plate */}
          <Field label="Registration Number">
            <ShakeWrap controls={plateShake.controls}>
              <input className="input-dark w-full font-mono uppercase" placeholder="OD05AB1234"
                maxLength={11}
                value={plate}
                onChange={e => {
                  setPlate(e.target.value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 11))
                  setPlateError('')
                }}
                onBlur={() => { if (plate && !isValidPlate(plate)) plateShake.shake() }} />
            </ShakeWrap>
            <FieldError message={
              plateError || (plate && !isValidPlate(plate) ? 'Enter valid plate number (e.g. OD05AB1234)' : null)
            } />
          </Field>

          {/* Year */}
          <Field label="Year of Manufacture">
            <ShakeWrap controls={yearShake.controls}>
              <input className="input-dark w-full" placeholder="2022" inputMode="numeric" maxLength={4}
                value={modelYear}
                onChange={e => { setModelYear(e.target.value.replace(/\D/g, '').slice(0, 4)); setYearError('') }}
                onBlur={() => {
                  if (modelYear && !isValidYear(modelYear)) {
                    setYearError(`Year must be between ${MIN_MODEL_YEAR} and ${MAX_MODEL_YEAR}`)
                    yearShake.shake()
                  } else {
                    setYearError('')
                  }
                }} />
            </ShakeWrap>
            <FieldError message={yearError} />
          </Field>

          {/* Registration Date */}
          <Field label="Registration Date">
            <DatePickerSheet
              label="Registration Date"
              value={registrationDate}
              onChange={setRegistrationDate}
              maxDate={TODAY_ISO}
              placeholder="Select registration date"
            />
          </Field>

          {/* Fuel type */}
          <Field label="Fuel Type">
            <div className="grid grid-cols-4 gap-2">
              {FUEL_TYPES.map(f => (
                <button key={f.value} onClick={() => setFuelType(f.value)}
                  className={`py-3 rounded-xl border-2 font-semibold text-xs transition-all ${fuelType === f.value ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Color */}
          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${color === c ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                  {c}
                </button>
              ))}
            </div>
          </Field>

          {/* Seating + Luggage: steppers */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Seats">
              <Stepper value={seating} min={1} max={8} unit="seat" onChange={setSeating} />
            </Field>
            <Field label="Luggage Bags">
              <Stepper value={luggage} min={0} max={5} unit="bag" onChange={setLuggage} />
            </Field>
          </div>

          {/* AC toggle */}
          <Field label="Air Conditioning">
            <div className="flex gap-3">
              {[true, false].map(v => (
                <button key={String(v)} onClick={() => setAc(v)}
                  className={`flex-1 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${ac === v ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                  {v ? 'AC Available' : 'Non-AC'}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </main>

      <footer
        className="flex-shrink-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-sm"
        style={{ boxShadow: '0 -1px 2px rgba(15,23,42,0.04)' }}
      >
        {error && <p className="text-accent-red text-xs text-center mb-2">{error}</p>}
        <button
          onClick={() => void handleSave()}
          disabled={!isValid || isSaving}
          className="btn-go w-full flex items-center justify-center gap-2"
          style={{ minHeight: 52 }}
        >
          {isSaving
            ? <><OcarSpinner size={16} variant="white" />Saving…</>
            : saved
              ? <><Check size={16} /> Saved</>
              : 'Save changes'}
        </button>
      </footer>
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

function Stepper({ value, min, max, unit, onChange }: {
  value: number; min: number; max: number; unit: string; onChange: (v: number) => void
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 bg-white border border-slate-200 rounded-2xl py-4 px-3"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)', minHeight: 108 }}
    >
      <span className="text-[40px] font-black text-slate-800 leading-none tabular-nums">{value}</span>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
        {value === 1 ? unit : `${unit}s`}
      </span>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${unit}`}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 border border-slate-200 text-blue-600 active:scale-90 transition-transform disabled:opacity-25 disabled:active:scale-100"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${unit}`}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 border border-slate-200 text-blue-600 active:scale-90 transition-transform disabled:opacity-25 disabled:active:scale-100"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}
