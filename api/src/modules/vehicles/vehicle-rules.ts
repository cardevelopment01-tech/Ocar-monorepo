import { httpError } from '@/lib/errors'

// What a driver may register is decided by the catalogue, not by the driver: the model fixes the category, the category
// fixes the seats, and the model limits the fuel types. A driver who cannot find their model registers without one.

export type ModelRuleRow = {
  id: number
  brand_id: number
  /** The catalogue name: it is what gets stored as the vehicle name, not whatever the app sent. */
  name?: string
  is_active: boolean
  typical_category_id: number | null
  /** NULL = every fuel type is allowed. */
  fuel_types: string[] | null
  /** max_passengers of the model's category (null when the model has no category yet). */
  category_seats: number | null
}

export type VehicleChoice = {
  category_id: number
  brand_id: number
  model_id?: number | undefined
  fuel_type: string
  seating_capacity: number
}

export type RuledChoice = { category_id: number; seating_capacity: number; needs_model_review: boolean }

/**
 * `model` is the catalogue row for `choice.model_id` (null when there is no such model). Throws a 422 for a model that is
 * not valid for the brand or a fuel the model is not sold with. A model with no category yet keeps the driver's own
 * category and seats, so a catalogue gap never blocks an onboarding that worked before.
 */
export function applyModelRules(choice: VehicleChoice, model: ModelRuleRow | null): RuledChoice {
  if (choice.model_id === undefined) {
    return { category_id: choice.category_id, seating_capacity: choice.seating_capacity, needs_model_review: true }
  }
  if (!model || !model.is_active || model.brand_id !== choice.brand_id) {
    throw httpError(422, 'Pick a model from the list for that brand.', 'MODEL_NOT_VALID')
  }
  if (model.fuel_types && !model.fuel_types.includes(choice.fuel_type)) {
    throw httpError(422, 'That model is not available with the fuel type you chose.', 'MODEL_FUEL_NOT_AVAILABLE')
  }
  if (model.typical_category_id === null) {
    return { category_id: choice.category_id, seating_capacity: choice.seating_capacity, needs_model_review: false }
  }
  return {
    category_id: model.typical_category_id,
    seating_capacity: model.category_seats ?? choice.seating_capacity,
    needs_model_review: false,
  }
}
