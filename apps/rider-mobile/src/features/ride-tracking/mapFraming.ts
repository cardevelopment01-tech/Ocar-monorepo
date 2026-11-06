// Where the rider's live map should put things, given that a docked sheet covers the bottom of it.
//
// The tracking screen draws the map full-screen with a sheet floating over its lower part (up to ~62% of the screen).
// Framing "pickup + car" with the default 80 px padding put the southern-most of them under that sheet, so the rider saw
// a pickup pin and no car ("the car isn't showing and isn't moving"). These helpers pad the camera by the sheet's real
// height and judge "is the car in view" against the part of the map that is actually visible. Pure: no React Native.

export type Padding = { top: number; right: number; bottom: number; left: number }

/** Space kept between the sheet's top edge and the lowest thing on the map, so a pin or car is not cut by the edge. */
export const SHEET_BREATHING_PX = 28
/** However tall the sheet is, at least this share of the map's height stays available for framing the trip. */
export const MIN_VISIBLE_FRACTION = 0.2
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
