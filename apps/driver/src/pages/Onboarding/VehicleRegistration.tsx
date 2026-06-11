import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { onboardingApi, type VehicleInfoPayload, type VehicleCategory, type VehicleBrand, type VehicleModel } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

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
  const [vehicleName, setVehicleName] = useState('')
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
        if (v.vehicle_name) setVehicleName(v.vehicle_name)
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
    setModels([])
    try {
      const m = await onboardingApi.getModels(id)
      setModels(m)
      if (m[0]?.typical_category_id) setCategoryId(Number(m[0].typical_category_id))
    } catch { /* ignore */ }
  }

  const isValidPlate = (p: string) =>
    /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/.test(p.replace(/\s/g, '').toUpperCase())

  const isValid = categoryId && brandId && vehicleName.trim() && modelYear && plate && isValidPlate(plate) && color && fuelType

  const handleContinue = async () => {
    if (!isValid) return
    setPlateError('')
    setError(null)
    setIsLoading(true)
    try {
      const payload: VehicleInfoPayload = {
        category_id: Number(categoryId),
        brand_id: Number(brandId),
        vehicle_name: vehicleName.trim(),
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
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-10">
      {/* Step bar */}
      <div className="flex gap-1.5 mb-8">
        {steps.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-surface-3'}`} />
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <p className="text-text-muted text-xs">Step 2 of 4</p>
          <h1 className="text-xl font-bold">Vehicle Details</h1>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {/* Brand */}
        <Field label="Brand">
          <select className="input-dark w-full" value={brandId ?? ''} onChange={e => void handleBrandChange(Number(e.target.value))}>
            <option value="" disabled>Select brand</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>

        {/* Vehicle Name */}
        <Field label="Vehicle Name">
          <input
            className="input-dark w-full"
            placeholder="e.g. Dzire, i20, Polo"
            value={vehicleName}
            onChange={e => setVehicleName(e.target.value)}
            list="model-suggestions"
          />
          {models.length > 0 && (
            <datalist id="model-suggestions">
              {models.map(m => <option key={m.id} value={m.name} />)}
            </datalist>
          )}
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

        {/* Seating + Luggage */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seating Capacity">
            <select className="input-dark w-full" value={seating} onChange={e => setSeating(Number(e.target.value))}>
              {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} seats</option>)}
            </select>
          </Field>
          <Field label="Luggage Bags">
            <select className="input-dark w-full" value={luggage} onChange={e => setLuggage(Number(e.target.value))}>
              {[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
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

      {error && <p className="text-accent-red text-sm mb-4">{error}</p>}

      <button onClick={handleContinue} disabled={!isValid || isLoading} className="btn-go w-full" style={{ minHeight: 56 }}>
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
      <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 block">{label}</label>
      {children}
    </div>
  )
}
