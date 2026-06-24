---
target: ReferenceSelfie camera onboarding
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-06-24T09-23-09Z
slug: ps-driver-src-pages-onboarding-referenceselfie-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | No camera-loading state — black void while stream initializes |
| 2 | Match System / Real World | 3 | "No glasses" tip is outdated KYC guidance |
| 3 | User Control and Freedom | 2 | Back button on preview navigates away from selfie page, not back to camera |
| 4 | Consistency and Standards | 2 | Mismatched chip rounding; stepIdx still derived from state not hardcoded |
| 5 | Error Prevention | 3 | Double-submit blocked; no confirmation when leaving preview |
| 6 | Recognition Rather Than Recall | 3 | Instructions and tips on screen |
| 7 | Flexibility and Efficiency | 3 | Simple linear flow, appropriate |
| 8 | Aesthetic and Minimalist Design | 3 | Camera stage clean; error screens skeletal |
| 9 | Error Recovery | 2 | "Submission failed" is not actionable; permission screen no OS steps |
| 10 | Help and Documentation | 2 | No instructions for how to grant camera access |
| **Total** | | **26/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: Camera stage avoids AI slop — full-black immersive layout, oval guide, shutter ring, and animated chips are compositionally confident. No gradient text, no card grids. Oval tick marks (lines 327-336) are placed at cardinal midpoints, creating a targeting reticle rather than the corner-bracket KYC convention expected by Indian users. The critical slop is in the error surfaces — `permissionDenied` and `camError` screens feel generated, not designed.

**Deterministic scan**: detect.mjs returned [] — zero findings.

## Overall Impression

Camera stage is the best screen in driver onboarding — immersive, focused, excellent CTA copy. The gap between camera stage and error/permission screens is jarring. Biggest opportunity: permission-denied screen is seen by every iOS user on first install and currently reads as a rough draft.

## What's Working

1. Shutter button: outer ring + inner disc with whileTap scale is correct iOS camera affordance, 76×76px touch target.
2. OvalOverlay box-shadow trick: correct implementation, no z-index conflicts.
3. "Submit & Start Driving" copy: names both action and reward — motivational at the emotional peak.

## Priority Issues

**[P1] Camera loading gap — black void during stream initialization**
- Why it matters: Black screen reads as "app froze." High-stakes final step.
- Fix: Add cameraReady state, set on video.onloadedmetadata. Show OcarSpinner until ready.
- Command: /impeccable harden

**[P1] Permission-denied screen: no OS instructions, undersized CTA**
- Why it matters: iOS requires Settings navigation. Without instructions, users close the app and never return.
- Fix: Dark bg matching camera aesthetic, step-by-step "Settings → Privacy → Camera" instructions, promote retry to btn-go full-width CTA.
- Command: /impeccable harden

**[P1] Back button on preview exits page entirely, leaks previewUrl**
- Why it matters: Users expect back on preview to retake, not abandon the step. previewUrl object URL never revoked.
- Fix: Check stage === 'preview' in back handler, call retake() instead of navigate(-1).
- Command: /impeccable harden

**[P2] stepIdx still derived from driver?.onboarding_step instead of hardcoded 3**
- Why it matters: Inconsistent with PersonalDetails/VehicleRegistration/Documents after the refactor.
- Fix: Replace lines 27-28 with const stepIdx = 3.
- Command: /impeccable polish

**[P2] Cardinal tick marks on oval read as targeting reticle, not KYC face guide**
- Why it matters: Indian users expect corner-bracket L-shapes (Aadhaar-style), not midpoint crosshairs.
- Fix: Move marks to four diagonal corners as L-shaped brackets.
- Command: /impeccable polish

## Persona Red Flags

**Jordan (First-Timer)**: Permission-denied gives no path to Settings. "No glasses" creates anxiety. Back on preview exits entire step.

**Casey (Distracted Mobile User)**: 2-second black loading screen reads as crash on first open. Shutter and action buttons are correctly in thumb zone.

## Minor Observations

- camError state is visually bare vs permissionDenied state.
- Instruction chip rounded-full vs tips chip rounded-2xl inconsistency.
- Disabled Retake has no visual treatment during submission.
- OvalOverlay key uses array index.
