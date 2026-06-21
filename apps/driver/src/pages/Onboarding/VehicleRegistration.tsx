import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Minus, Plus } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { onboardingApi, type VehicleInfoPayload, type VehicleCategory, type VehicleBrand, type VehicleModel } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'
import InlineSelect from '@/components/ui/InlineSelect'

const COLORS = ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Green', 'Yellow', 'Orange', 'Other'] as const
const FUEL_TYPES = [
  { value: 'petrol',   label: 'Petrol' },
  { value: 'diesel',   label: 'Diesel' },
  { value: 'cng',      label: 'CNG'    },
  { value: 'electric', label: 'EV'     },
] as const

export default function VehicleRegistration() {
  const navigate = useNavigate()
  const updateDriver = useAuthStore(s => s.updateDriver)
  const driver = useAuthStore(s => s.driver)

  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [brands, setBrands] = useState<VehicleBrand[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [loadError, setLoadError] = useState(false)

  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [brandId, setBrandId] = useState<number | null>(null)
  const [modelId, setModelId] = useState<number | null>(null)
  const [modelYear, setModelYear] = useState('')
  const [plate, setPlate] = useState('')
  const [color, setColor] = useState('')
  const [fuelType, setFuelType] = useState('')
  const [seating, setSeating] = useState(4)
  const [luggage, setLuggage] = useState(2)
  const [ac, setAc] = useState(true)

  const [plateError, setPlateError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const currentStep = driver?.onboarding_step ?? 'vehicle_info'
  const steps = ['personal_info', 'vehicle_info', 'documents', 'selfie']
  const stepIdx = steps.indexOf(currentStep)

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
        if (v.model_year)   setModelYear(String(v.model_year))
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
    /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/.test(p.replace(/\s/g, '').toUpperCase())

  const selectedModel = models.find(m => Number(m.id) === modelId)
  const isValid = categoryId && brandId && modelId && selectedModel && modelYear && plate && isValidPlate(plate) && color && fuelType

  const handleContinue = async () => {
    if (!isValid) return
    setPlateError('')
    setError(null)
    setIsLoading(true)
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
      const result = await onboardingApi.saveVehicleInfo(payload)
      updateDriver({ onboarding_step: result.next_step })
      navigate('/onboarding/documents')
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
      setIsLoading(false)
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
    <>
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-40">
      {/* Step bar */}
      <div className="flex gap-1.5 mb-8">
        {steps.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 2 of 4</p>
          <h1 className="text-xl font-bold">Vehicle Details</h1>
        </div>
      </div>
      <p className="text-text-muted text-xs mb-5">Progress is saved automatically</p>

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
        </Field>

        {/* Number plate */}
        <Field label="Registration Number">
          <input className="input-dark w-full font-mono uppercase" placeholder="OD05AB1234"
            value={plate} onChange={e => { setPlate(e.target.value.toUpperCase()); setPlateError('') }} />
          {plateError
            ? <p className="text-accent-red text-xs mt-1">{plateError}</p>
            : plate && !isValidPlate(plate)
              ? <p className="text-accent-red text-xs mt-1">Enter valid plate number (e.g. OD05AB1234)</p>
              : null}
        </Field>

        {/* Year */}
        <Field label="Year of Manufacture">
          <input className="input-dark w-full" placeholder="2022" inputMode="numeric" maxLength={4}
            value={modelYear} onChange={e => setModelYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
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

        {/* Seating + Luggage — steppers */}
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
    </div>

    {/* Sticky footer CTA */}
    <div className="fixed bottom-0 left-0 right-0 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-sm border-t border-border z-20">
      {!isValid && !error && (
        <p className="text-text-muted text-xs text-center mb-2">
          {!brandId    ? 'Select your vehicle brand'
          : !modelId   ? 'Select your vehicle model'
          : !color     ? 'Select vehicle colour'
          : !fuelType  ? 'Select fuel type'
          : !plate     ? 'Enter registration number'
          : plate && !isValidPlate(plate) ? 'Enter a valid registration number'
          : !modelYear ? 'Enter year of manufacture'
          : ''}
        </p>
      )}
      {error && <p className="text-accent-red text-xs text-center mb-2">{error}</p>}
      <button onClick={handleContinue} disabled={!isValid || isLoading} className="btn-go w-full" style={{ minHeight: 52 }}>
        {isLoading
          ? <span className="flex items-center justify-center gap-2">
              <OcarSpinner size={16} variant="white" />
              Saving…
            </span>
          : 'Continue'}
      </button>
    </div>
    </>
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
