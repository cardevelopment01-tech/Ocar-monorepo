import { describe, it, expect } from 'vitest'
import { applyModelRules, type ModelRuleRow, type VehicleChoice } from '@/modules/vehicles/vehicle-rules'

// Value: protects=a driver cannot register a category, seat count or fuel the catalogue does not give their model (so a
// hatchback is not registered as Luxury and a petrol car is not registered as electric to skip the permit and PUC);
// fails_when=the client's category/seats/fuel is trusted over the model's, a model from another brand or an inactive one is
// accepted, or a driver whose model has no category yet is blocked; why_new=the server accepted any combination;
// seam=none (pure rules); no_claim=the database lookup (tests/unit/drivers/save-vehicle-model.test.ts wires it).

const SWIFT: ModelRuleRow = { id: 10, brand_id: 1, is_active: true, typical_category_id: 1, fuel_types: ['petrol', 'cng'], category_seats: 4 }
const choice = (over: Partial<VehicleChoice> = {}): VehicleChoice =>
  ({ category_id: 4, brand_id: 1, model_id: 10, fuel_type: 'petrol', seating_capacity: 8, ...over })

describe('applyModelRules', () => {
  it("takes the category and the seats from the model, whatever the driver sent", () => {
    expect(applyModelRules(choice(), SWIFT)).toEqual({ category_id: 1, seating_capacity: 4, needs_model_review: false })
  })

  it('a driver whose model is not in the list registers without one and is flagged for review, keeping their own choice', () => {
    const { model_id: _drop, ...rest } = choice({ category_id: 2, seating_capacity: 4 })
    expect(applyModelRules(rest, null)).toEqual({ category_id: 2, seating_capacity: 4, needs_model_review: true })
  })

  it('refuses a model that does not exist, is inactive, or belongs to another brand', () => {
    for (const model of [null, { ...SWIFT, is_active: false }, { ...SWIFT, brand_id: 2 }]) {
      expect(() => applyModelRules(choice(), model)).toThrow(/Pick a model from the list/)
      try { applyModelRules(choice(), model) } catch (e) { expect(e).toMatchObject({ httpStatus: 422, appCode: 'MODEL_NOT_VALID' }) }
    }
  })

  it('limits the fuel to what the model is sold with, so a petrol model cannot be registered as electric', () => {
    expect(() => applyModelRules(choice({ fuel_type: 'electric' }), SWIFT)).toThrow(/not available with the fuel type/)
    try { applyModelRules(choice({ fuel_type: 'diesel' }), SWIFT) } catch (e) { expect(e).toMatchObject({ appCode: 'MODEL_FUEL_NOT_AVAILABLE' }) }
    expect(applyModelRules(choice({ fuel_type: 'cng' }), SWIFT).category_id).toBe(1)
  })

  it('an electric-only model accepts electric and nothing else', () => {
    const ev = { ...SWIFT, fuel_types: ['electric'] }
    expect(applyModelRules(choice({ fuel_type: 'electric' }), ev).needs_model_review).toBe(false)
    expect(() => applyModelRules(choice({ fuel_type: 'petrol' }), ev)).toThrow()
  })

  it('a model with no fuel list allows every fuel', () => {
    for (const fuel_type of ['petrol', 'diesel', 'cng', 'electric']) {
      expect(() => applyModelRules(choice({ fuel_type }), { ...SWIFT, fuel_types: null })).not.toThrow()
    }
  })

  it("a model with no category yet keeps the driver's own category and seats (a catalogue gap never blocks onboarding)", () => {
    const noCategory = { ...SWIFT, typical_category_id: null, category_seats: null }
    expect(applyModelRules(choice({ category_id: 3, seating_capacity: 6 }), noCategory))
      .toEqual({ category_id: 3, seating_capacity: 6, needs_model_review: false })
  })
})
