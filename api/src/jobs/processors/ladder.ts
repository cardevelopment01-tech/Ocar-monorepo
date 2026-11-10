// Dispatch fast rounds: the steps to try, in order, when a broadcast round's normal search finds nobody (see
// docs/superpowers/plans/2026-11-10-dispatch-phase0-fast-rounds-and-logging.md). Pure, so it is tested without the queue.
//
//   round 1 searches the exact vehicle category only; its widening first adds the fallback categories at the same radius, then goes
//   wider (exact first, then fallback) one step at a time;
//   rounds 2 and 3 already use the fallback categories, so their widening is radius only;
//   nothing widens past the last round's radius (`capMax`), so a ride never reaches farther than round 3 would have.
export type LadderStep = { radiusMetres: number; exactOnly: boolean }

export function fastRoundSteps(round: number, capNow: number, capMax: number, stepMetres: number): LadderStep[] {
  if (!(stepMetres > 0) || capMax <= capNow && round > 1) return []
  const steps: LadderStep[] = []
  if (round === 1) steps.push({ radiusMetres: capNow, exactOnly: false })
  for (let r = capNow + stepMetres; r <= capMax + 1e-9; r += stepMetres) {
    if (round === 1) steps.push({ radiusMetres: r, exactOnly: true })
    steps.push({ radiusMetres: r, exactOnly: false })
  }
  return steps
}
