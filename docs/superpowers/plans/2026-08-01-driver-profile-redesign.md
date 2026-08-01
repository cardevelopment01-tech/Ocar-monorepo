# Driver App Profile Redesign — Fix Broken Navigation + Honest Settings IA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The driver app's Profile tab (`apps/driver/src/pages/Profile.tsx`) has 5 menu items. Three of them (`Vehicle Details`, `Documents`, `Emergency Contacts`) route into the **onboarding wizard** — a linear, progress-barred, "Continue to next step" flow meant for first-time signup. An already-approved driver tapping these gets shoved into a completion-gated flow that ends with "Continue to Selfie," which reads as broken. `Emergency Contacts` is also mislabeled: it opens the full Personal Details form (10 fields: DOB, address, pincode, languages…) to edit one phone number. The remaining two items (`Help & Support`, `Terms & Privacy`) are a bare `mailto:` and an external link, styled identically to in-app navigation rows with no visual signal that they leave the app.

**Root cause:** the onboarding wizard's shell (`OnboardingShell.tsx`) and its three step pages have no concept of "already onboarded, just viewing/editing." Only one mode exists.

**Revision note:** the first version of this plan proposed reusing `OnboardingShell` with a `standalone` flag to avoid building new screens. Researched against real driver apps (Uber Driver, Ola, Rapido Captain, Lyft, inDrive, Bolt Driver) and reconsidered: none of them reuse the onboarding stepper for post-approval editing. They reuse *leaf* components (upload widgets, date pickers, individual inputs) but always build a separate flat settings screen — no stepper, no forced sequence, no "Continue to next step" language, independent "Save" per screen. The flag-threading approach was the smaller diff but the wrong place to put it: it would have coupled two state models (build-up-from-nothing vs. edit-one-field-in-isolation) and grown a flag surface (`standalone`, `skipValidation`, `allowPartialSave`...) inside a shell that has to keep serving a completely different UX contract. **Revised approach: three small dedicated screens, reusing only the leaf form/upload components, not the wizard shell.**

**Scope:** Frontend only, `apps/driver`. **No new backend endpoints needed** — confirmed by reading `api/src/modules/drivers/drivers.service.ts`:
- `getMe()` (L75-95) already returns `driver`, `stats.rating_avg`, `stats.top_tags`, and `onboarding.missing_documents` — the last of which Profile.tsx already fetches but never reads.
- `getDocumentStatus()` (L239) and `findVehicleByDriverId()` already back the Documents/Vehicle pages.
- `getPersonalInfo()` / `savePersonalInfo()` (L104-128) already back the Personal Details page.

**Explicitly out of scope (researched via Fable 5, deliberately deferred, not silently dropped):**
- **Language selector (Odia/Hindi/English).** Flagged as a real must-have for an India driver app, but there is no i18n framework anywhere in this codebase today. That's a standalone feature project, not a profile-menu tweak. Revisit separately.
- **Dedicated single-field "emergency contact" screen.** The lazy fix is relabeling the menu item to match what the form actually is (see Task 3), not building a second, narrower form against the same `savePersonalInfo` endpoint.
- **In-app FAQ/chat, multi-vehicle switching, dark mode, GST self-service, per-notification-type toggles.** All researched as either already-covered (Wallet tab covers payout), premature (single-vehicle model per CLAUDE.md), or genuinely low-value at this stage. See Fable research notes below if these get revisited.
- **Ratings history detail page.** `stats.rating_avg` / `top_tags` are already shown on the avatar card. A full ratings-history list would need confirming a driver-facing ratings-list endpoint exists — not confirmed in this pass, so left out rather than guessed at.

**Tech stack:** React 19 + Vite, React Router v6, Tailwind (Ocar `DESIGN.md` tokens), `framer-motion` (already installed and correctly used — `useReducedMotion` respected in both `Profile.tsx` and `BottomNav.tsx`), `lucide-react`. Nothing new to install.

---

## Task 1: Extract leaf components so both wizard and settings screens can share them — ✅ DONE

**Files:**
- New: `apps/driver/src/components/documents/DocGroupCard.tsx`, `DocSlot.tsx`, `DocPreviewModal.tsx`, `SectionHeader.tsx` — pulled out of `apps/driver/src/pages/Onboarding/Documents.tsx` (currently private, unexported functions at L348-575) verbatim, just moved to their own files and exported.
- Modify: `apps/driver/src/pages/Onboarding/Documents.tsx` — import the extracted components instead of defining them inline; no behavior change.
- New: `apps/driver/src/components/settings/SettingsHeader.tsx` — a small flat header for the new settings screens: back button (always → `/profile`) + title. No step count, no progress bars. Not a fork of `OnboardingShell`; a separate, much simpler component, because a settings screen's header has a genuinely different contract (no sequence, no step index).

Do **not** touch `OnboardingShell.tsx` or `VehicleRegistration.tsx` / `PersonalDetails.tsx`'s existing step-page behavior — the onboarding flow is untouched, only its documents sub-components move to be importable.

## Task 2: Build 3 dedicated settings screens — ✅ DONE

Implementation note: `DRIVER_GROUPS`/`VEHICLE_GROUPS`/`ALL_GROUPS`/`initSlotState` (the document-set data, not UI) were also extracted to `apps/driver/src/components/documents/groups.ts` — this data is identical for the wizard and settings screen, and duplicating it verbatim across two files would have been a silent drift risk (add a doc type in one, forget the other). This is a data extraction, not a UI/flow-shell extraction, so it doesn't reintroduce the shared-wizard problem this plan was revised to avoid.

**Files:**
- New: `apps/driver/src/pages/Settings/VehicleDetails.tsx`
- New: `apps/driver/src/pages/Settings/DriverDocuments.tsx`
- New: `apps/driver/src/pages/Settings/PersonalInfo.tsx`
- Modify: `apps/driver/src/App.tsx` — add three routes: `/profile/vehicle`, `/profile/documents`, `/profile/personal`.

Each screen:
- Uses `SettingsHeader` (Task 1), not `OnboardingShell`. No stepper, no "Step X of Y."
- Self-loads its own current data on mount from the **same already-existing endpoints** the onboarding pages use (`onboardingApi.getDocumentStatus()`, `findVehicleByDriverId`-backed endpoint, `getPersonalInfo()`) — these already return real saved data regardless of caller, confirmed in `drivers.service.ts`.
- Has its own local form state, independent of any wizard step index.
- One "Save" button per screen (or per document group for `DriverDocuments`, since re-uploading one expired doc shouldn't require touching the rest) — never "Continue," never blocked by unrelated fields being incomplete elsewhere on the same screen.
- On save success: show inline confirmation (toast or checkmark), stay on the page — do **not** auto-navigate anywhere. Editing your vehicle plate number should not launch you into document upload.
- `DriverDocuments.tsx` specifically: reuse `DocGroupCard` / `DocSlot` / `SectionHeader` / `DocPreviewModal` from Task 1 as-is — same upload widgets, same expiry date picker, same visual states (uploaded/rejected/pending). Only the surrounding page chrome and the footer button are different from the onboarding version.

This intentionally does **not** build a shared "form engine" or config-driven step system — three flat, independent screens is the correctly-sized solution here. A shared abstraction across them is premature until a 4th genuinely similar screen shows up.

## Task 3: Rewrite Profile.tsx menu — fix routes, fix labels, group by section — ✅ DONE

**Files:**
- Modify: `apps/driver/src/pages/Profile.tsx`

- [x] **Step 1 (done as part of Task 2):** Fix `handleMenu` (L62-68) to point at the new dedicated settings routes from Task 2, not the onboarding wizard:
  ```ts
  if (action === 'vehicle')   { navigate('/profile/vehicle');   return }
  if (action === 'documents') { navigate('/profile/documents'); return }
  if (action === 'personal')  { navigate('/profile/personal');  return }
  ```
- [x] **Step 2:** Relabeled `Emergency Contacts` → `Personal & Emergency Info`, sub-label → `Address, ID & emergency contact`.
- [x] **Step 3:** Grouped into `MENU_SECTIONS` (3 sections, plain 12px/medium sentence-case labels, no eyebrow tracking), each its own `card-glossy` block:
  - **Vehicle & documents** — Vehicle Details, Documents
  - **Account** — Personal & Emergency Info
  - **Support & legal** — Help & Support, Terms & Privacy
- [x] **Step 4:** `getMe()`'s `onboarding.missing_documents` is now read into an `onboarding` state slice and surfaced as an amber "N pending" pill on the Documents row when non-empty. Zero new API calls.
- [x] **Step 5:** `Help & Support` / `Terms & Privacy` rows (marked `external: true` in `MENU_SECTIONS`) now render an `ExternalLink` icon instead of `ChevronRight`. The `mailto:` link is prefilled with `subject=Driver ${driver?.code} — Support`.

Verified: `tsc --noEmit` and `vite build` both clean.

## Task 4: Motion pass — ✅ DONE

**Files:**
- Modify: `apps/driver/src/pages/Profile.tsx`

- [x] Extended the existing stagger pattern to the section headers: each section (header + card) is one `motion.div`, same `opacity/x` reveal, same `duration: 0.24`, same `ease: [0.16,1,0.3,1]`, staggered by section index (`si * 0.06`) instead of by individual row (previously `i * 0.04` per row). Fewer discrete animated elements (3 sections vs. 5 rows) — a more restrained result, consistent with Emil-primary weighting, not a new vocabulary.
- [x] No new animation library, no added choreography. `useReducedMotion` still gates the reveal via the same `prefersReducedMotion` conditional already in the file.

---

## Verification

- [x] **Live click-through performed** (real API + Docker Postgres + a real driver account through the actual OTP login flow, driven headlessly via Playwright): walked all 3 new `/profile/*` routes as an *already-approved* driver. Confirmed: no progress bar, no "Continue to next step" language (`"Continue to..."` text count = 0 on all three, vs. 1 on the real onboarding wizard), back button returns to `/profile` each time, `/profile/vehicle` and `/profile/personal` show a "Save changes" button. Screenshots captured for all 3 screens plus the Profile page itself.
- [x] Confirmed the untouched `/onboarding/*` routes still show the full wizard chrome exactly as before — both statically (`git diff --stat` on `Documents.tsx`: 6 insertions, 345 deletions, nothing changed in between; `OnboardingShell.tsx`/`VehicleRegistration.tsx`/`PersonalDetails.tsx` don't appear in `git status` at all) and live: `/onboarding/documents` screenshot shows "Step 3 of 4", progress bars, "Progress is saved automatically," and "Continue to Selfie" — pixel-identical in spirit to pre-change behavior.
- [x] Confirmed `missing_documents` pill renders correctly against real backend data: a freshly created test driver (zero uploaded documents) shows "10 pending" on the Documents row, sourced from `getMe()`'s real `onboarding.missing_documents` array, not mocked.
- [x] `prefers-reduced-motion`: code-verified — the new section-`motion.div` reuses the same `prefersReducedMotion ? false : {...}` conditional already governing the avatar card's animation; no separate motion path was introduced.
- [x] No console or page errors during the full flow (login → profile → all 3 settings screens → back navigation → onboarding wizard comparison).

**Environment note:** the local `ocar_postgres` Docker volume had stale PG16 data files against a compose file now pulling PG17 — had to be wiped and reinitialized (confirmed with the user first: it's the local dev DB only, `localhost:5434`, not Neon). Also found and fixed two pre-existing local misconfigurations unrelated to this change: `api/.env` was missing `BANK_ACCOUNT_ENCRYPTION_KEY` (server wouldn't boot), and `apps/driver/.env.local`'s `VITE_API_URL` pointed at port `3000` instead of `4000` (confirmed against `apps/user` and `apps/admin`, both correctly `4000`).

## Deferred (do not build now, listed so it isn't silently forgotten)

- Language/i18n selector — needs a real i18n framework decision first.
- Ratings-history detail page — needs confirming a driver ratings-list endpoint exists.
- In-app Help/FAQ content — currently just an honest `mailto:`; building real in-app support content is a content project, not a UI fix.
