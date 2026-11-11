// Where the rider's live map should put things, given that a docked sheet covers the bottom of it.
//
// The tracking screen draws the map full-screen with a sheet floating over its lower part (up to ~62% of the screen).
// Framing "pickup + car" with the default 80 px padding put the southern-most of them under that sheet, so the rider saw
// a pickup pin and no car ("the car isn't showing and isn't moving"). These helpers pad the camera by the sheet's real
// height and judge "is the car in view" against the part of the map that is actually visible. Pure: no React Native.

export type Padding = { top: number; right: number; bottom: number; left: number }

/** Space kept between the sheet's top edge and the lowest thing on the map, so a pin or car is not cut by the edge. */
export const SHEET_BREATHING_PX = 48
/** However tall the sheet is, at least this share of the map's height stays available for framing the trip. */
export const MIN_VISIBLE_FRACTION = 0.1
/** A sheet that grows or shrinks by less than this is not worth re-framing the camera for. */
export const SHEET_RESIZE_STEP_PX = 24

/**
 * The camera padding: `base` with the bottom raised to clear the sheet. `coveredBottom` is the sheet's height in px
 * (0 / unknown = no sheet measured yet: keep `base`). `mapHeight` caps it so a very tall sheet cannot leave no room.
 */
export function framingPadding(base: Padding, coveredBottom: number, mapHeight: number): Padding {
  if (!(coveredBottom > 0)) return base
  const wanted = coveredBottom + SHEET_BREATHING_PX
  const ceiling = mapHeight > 0 ? mapHeight - base.top - mapHeight * MIN_VISIBLE_FRACTION : wanted
  const bottom = Math.max(base.bottom, Math.min(wanted, Math.max(ceiling, base.bottom)))
  return { ...base, bottom }
}

type Pt = [number, number]

/**
 * What the camera should frame. Three situations, each about what the rider is waiting for:
 *  - searching, with cars near the pickup: the pickup and those cars (the far drop squeezed them into a clump on the pin);
 *  - a driver is on the way to the pickup (`frameDrop` false): the pickup and the driver, so the car is seen approaching
 *    (framing the far drop put a car 1 km away on top of the pickup pin);
 *  - otherwise (no cars, or the trip is under way): the whole trip -- pickup, stops, drop and the driver.
 */
export function framePoints(a: {
  pickup: Pt
  stops: readonly Pt[]
  drop: Pt | null
  showDrop: boolean
  driverPos: Pt | null
  cars: readonly Pt[]
  frameDrop: boolean
}): Pt[] {
  if (!a.driverPos && a.cars.length > 0) return [a.pickup, ...a.cars]
  if (a.driverPos && !a.frameDrop) return [a.pickup, a.driverPos]
  const points: Pt[] = [a.pickup, ...a.stops]
  if (a.showDrop && a.drop) points.push(a.drop)
  if (a.driverPos) points.push(a.driverPos)
  return points
}

/** A point (screen px inside the map view) that the rider can actually see: on the map and not under the sheet. */
export function isInVisibleBand(
  point: { x: number; y: number },
  map: { width: number; height: number },
  coveredBottom: number,
  margin = 16,
): boolean {
  const bottom = map.height - Math.max(coveredBottom, 0) - margin
  return point.x >= margin && point.x <= map.width - margin && point.y >= margin && point.y <= bottom
}

/** The sheet height rounded to a step, so a few pixels of layout jitter never re-frames the camera. */
export function sheetHeightBucket(coveredBottom: number): number {
  return Math.round(Math.max(coveredBottom, 0) / SHEET_RESIZE_STEP_PX)
}
