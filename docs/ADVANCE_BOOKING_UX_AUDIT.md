# Advance Booking — UX/UI Redesign Audit
## The schedule trigger & the date/time picker

> Drafted July 2026. Scope: the **visual/interaction design** of the schedule-for-later feature in
> the user app — the trigger component (`ScheduleRideSheet.tsx`), the picker popup
> (`DateTimePickerSheet.tsx`), and small frontend-technical fixes around them.
> Every claim about current code below was verified against the actual source on this date.
>
> **Relationship to prior docs — read this first:**
> - `docs/ADVANCE_BOOKING_PLAN.md` is **partially stale**: it describes the backend as unwired
>   ("column exists, never written by any code path"). That is no longer true — the backend is
>   fully built (see §2). Its §0 industry research and §5–§8 edge-case reasoning remain valid.
> - `docs/SCHEDULE_UX_PLAN.md` is **superseded on placement**: its recommended relocation (schedule
>   control out of the cramped select-ride cluster, into its own row on `/search` and `/round-trip`)
>   has **already shipped**. What it never addressed — and what this audit covers — is the internal
>   design of the component itself and the picker popup. Do not re-execute that doc's §4 plan.
>
> **Explicitly out of scope:** backend rework. Dispatch, validation, BullMQ scheduling, the
> `scheduled` status, and the concurrency cap are done and correct. This is a UI/UX and
> frontend-technical audit only.

---

## 1. Current state, precisely

### 1.1 The trigger — `apps/user/components/ui/ScheduleRideSheet.tsx` (69 lines)

Despite the name, this is not a sheet. It renders a **boxed card** containing a label row and a
**two-pill 50/50 toggle**:

- Container (L27–30): `rounded-2xl px-3 py-2.5`, background `#F5F7FF`, border `1px solid #E8EEFF`.
- Label (L31): `PICKUP TIME`, `text-[10px] font-semibold`, color `#94A3B8`.
- Two `flex-1` pills (L32–53), each `py-2.5 rounded-xl text-[13px] font-semibold` with a 13px
  `Clock` icon — **both pills carry the same clock icon**, so the icon differentiates nothing.
  Active pill: `bg-indigo-600 text-white`. Inactive: `bg-white text-gray-600 border-gray-200`.
- Left pill = "Ride now" (`onChange(null)`); right pill = opens the picker; its label (L21–23) is
  the formatted date via `toLocaleString('en-IN', { hour12: true })` → e.g. **"9 Jul, 6:30 pm"**
  (12-hour), or "Now" when unset.
- Total rendered height: ~86–90px (label + 2px gap + 42px pills + card padding) at **full width**.
- L6–7: `MIN_ADVANCE_MINUTES = 60` and `MAX_ADVANCE_DAYS = 7` are **hardcoded locally**,
  duplicating `MIN_ADVANCE_BOOKING_MINUTES` / `MAX_ADVANCE_BOOKING_DAYS` in
  `api/src/constants/limits.ts` with no shared source of truth.

Mounted (all three placements already shipped, per `SCHEDULE_UX_PLAN.md`):

| Page | Location | Notes |
|---|---|---|
| `apps/user/app/(main)/search/page.tsx` L556–565 | Own row directly **below** the "Select on map / Add stops" pill row (L537–554, which uses compact `h-9` pills) | The two rows visibly clash in scale: 36px action pills above, 90px boxed card below |
| `apps/user/app/(main)/round-trip/page.tsx` L219–230 | Own `motion.section`, shown once `hasDestination` | Sits between the hour-chip selector and the "What's included" card |
| `apps/user/app/(main)/select-ride/page.tsx` L258–267 | Own row above the ride-type tabs, inside the sheet header | `onChange` also clears `isReturnCab` (correct coupling) |

### 1.2 The popup — `apps/user/components/ui/DateTimePickerSheet.tsx` (274 lines)

A **full-height-class bottom sheet** (`rounded-t-[28px]`, scrim `rgba(15,23,42,0.55)`, shadow
`0 -8px 40px rgba(79,70,229,0.18)`, Framer Motion slide-up `0.32s [0.16,1,0.3,1]`) containing,
top to bottom:

1. Drag handle + header (title/subtitle + 32px `X` close button, `#EEF2FF` bg).
2. **Month navigator** (L134–153): `w-8 h-8` (32px) chevron buttons, "July 2026" label.
3. **Full 7-column month calendar grid** (L156–187): `h-9` (36px) day cells, selected =
   `#4F46E5` filled circle, today = `#EEF2FF` tint, disabled = `#CBD5E1`.
4. Divider, then a `timeLabel` ("PICKUP TIME" — the **same label already printed on the trigger
   card** the user just tapped).
5. **Two independent chevron-stepper columns** (L195–251): hour and minute, each a `w-10 h-7`
   (**40×28px**) up button, a large `text-[26px] font-black` value box showing the value
   **zero-padded 24-hour** (`String(hour).padStart(2,'0')` → "18"), a 40×28px down button, and a
   10px "HOUR"/"MIN" caption. Minute steps in ±5 (L228, L243); hour wraps `(h+1)%24` (L199).
6. Confirm button (L256–266): full-width 52px gradient pill
   (`linear-gradient(135deg, #4F46E5, #7C3AED)`) labeled with `displayLabel` (L88) =
   `` `Jul 9 · ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}` `` →
   **"Jul 9 · 18:30" — 24-hour format**.

Legacy tell: the component's **default props** (L30–32) are `title = 'Return date & time'`,
`subtitle = 'Minimum 4 hours from now'`, `timeLabel = 'RETURN TIME'` — leftovers from the
round-trip return-picker era. `ScheduleRideSheet` is now its **only consumer** (verified by grep),
so those defaults are dead code and the component is free to be redesigned wholesale without
breaking anything else.

---

## 2. What is already correct — do not redo

1. **Placement.** The relocation out of the select-ride tab cluster into its own row on `/search`
   (L556), `/round-trip` (L219), and `/select-ride` (L258) shipped. Discoverability-before-car-
   selection is solved. `SCHEDULE_UX_PLAN.md` problems #1, #3 (partially), #4, #5: closed.
2. **Backend.** `api/src/modules/rides/rides.service.ts` L184–346 (`createBooking`) is fully wired:
   validates `scheduledFor` against `MIN_ADVANCE_BOOKING_MINUTES` / `MAX_ADVANCE_BOOKING_DAYS`
   (L219–232), enforces `MAX_CONCURRENT_SCHEDULED_BOOKINGS` (L233–239), creates the ride with
   `status: 'scheduled'` (L277–280), logs status history (L315–322), inserts `ride_advance_meta`
   (L324–328), and enqueues the delayed BullMQ `SCHEDULER` dispatch job with the
   `ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES` buffer (L330–337). **No backend changes in this audit.**
3. **Post-booking surface.** `apps/user/app/(main)/history/page.tsx` has a working "Upcoming" tab
   (`STATUS_KIND.scheduled = 'info'`, L43) with a proper empty state (L439–445: "No scheduled
   rides / Schedule now and we'll find your driver closer to pickup…") and cancel support.

The remaining gap — the subject of this audit — is the component's own design: the trigger is an
oversized two-pill card, and the popup is a dated calendar-grid + chevron-stepper picker.

---

## 3. The actual problems

### 3.1 The trigger is dramatically oversized for the decision it represents

"Now vs later" is a **default-heavy micro-decision**: the overwhelming majority of bookings are
"now," and every major app renders it as a compact chip, not a labeled card:

- Uber renders pickup time as a small **"Pickup now ▾" chip** in the request screen header; Reserve
  is a separate entry point, but the in-flow control is a chip
  ([Uber Reserve](https://www.uber.com/us/en/ride/how-it-works/reserve/),
  [Uber Help — scheduling](https://help.uber.com/riders/article/scheduling-a-ride-in-advance?nodeId=63165ec1-0910-409e-972f-0b8d8df1a605)).
- Ola's "Ride Later" is a **"Now ▾" affordance beside the search flow**, not a two-option toggle row
  ([Ola Ride Later](https://help.olacabs.com/support/dreport/205018412)).
- Rapido surfaces scheduling as a small entry + a home-screen reminder chip after booking
  ([Rapido scheduling concept study](https://medium.com/@corkidragon/scheduling-feature-for-rapido-1e1ed0b82313)).

Against that, Ocar's trigger spends ~90px of full-width vertical space on a boxed card with its own
section label to present a binary whose answer is "now" ~90%+ of the time. On `/search` it sits
directly under a row of 36px action pills, so the scale mismatch is visible in one glance — the
schedule card has **more visual weight than the destination confirmation actions above it**.
Specific defects:

- **The 50/50 split falsely equalizes the options.** A two-pill segmented control says "these are
  peers, choose one." They aren't peers; one is a default and one is an exception.
- **The boxed `PICKUP TIME` micro-label is redundant** — the clock icon + "Now"/date text is
  self-describing, and the identical label is repeated inside the picker sheet (L194 via the
  `timeLabel` prop). The user reads "PICKUP TIME" twice in two seconds.
- **The same clock icon on both pills** carries zero information.
- **No clear-back-to-now affordance on the scheduled state** other than re-tapping "Ride now" —
  works, but a set chip conventionally carries an inline `×`.

### 3.2 The popup's interaction cost is wrong for the real distribution of bookings

The decisive fact: **`MAX_ADVANCE_DAYS = 7`.** The booking window is `now + 1h` to `now + 7 days`.
A full month calendar grid therefore renders **~23 of 30 visible day cells permanently disabled**,
plus a month navigator (two 32px buttons) whose only legitimate use is the ≤7-day window straddling
a month boundary. The component ships an entire month-paging calendar to answer a question with at
most **8 valid answers** (today … today+7). This is the single clearest "dated UX" signal in the
feature and almost certainly what the client is reacting to.

Second: most advance bookings cluster at "later today" and "tomorrow morning" (airport runs,
Bhubaneswar↔Puri day trips). The current picker forces **every** user — including the "tomorrow
8 AM" majority — through: open sheet → parse a month grid → tap a day → operate **two independent
chevron steppers** (a 6:30 PM target from a 2:00 PM default = 4 hour-taps + up to 6 minute-taps)
→ confirm. That is 6–12 taps for what Uber/Ola resolve in 2–3. Industry pattern references
consistently recommend **preset slots/quick picks first, full picker second** for booking-type
flows ([Eleken — Time picker UX 2026](https://www.eleken.co/blog-posts/time-picker-ux),
[Mobbin — time picker patterns](https://mobbin.com/glossary/time-picker),
[Mobbin — date picker patterns](https://mobbin.com/glossary/date-picker)).

Third: chevron steppers are the **worst of the three canonical time-input variants** for this job.
Material 3 offers dial/keyboard-input pickers ([M3 time pickers](https://m3.material.io/components/time-pickers/),
[M3 date pickers](https://m3.material.io/components/date-pickers)); iOS convention is the scroll
wheel (`UIDatePicker`); slot lists suit fixed-interval booking. Chevron steppers are none of these
— they're a desktop spinbutton pattern with high per-unit tap cost, no gesture affordance, and no
type-in fallback. On mobile web they also feel non-native on **both** platforms simultaneously.

Fourth: **sheet size**. The sheet occupies roughly 70% of the viewport for what is usually a 2-tap
decision. NN/g's bottom-sheet guidance is that sheet size should track task size, and oversized
modal surfaces at non-natural pause points get dismissed reflexively
([NN/g — Bottom Sheets](https://www.nngroup.com/articles/bottom-sheet/)).

### 3.3 Technical/implementation defects (verified in code)

1. **12h/24h format inconsistency — confirmed.** The trigger label (`ScheduleRideSheet.tsx` L22)
   formats with `hour12: true` → "9 Jul, 6:30 pm". The picker's value boxes (L210, L239) and the
   confirm button (L88, L265) render zero-padded 24-hour → "Confirm — Jul 9 · 18:30". A user in
   India who thinks in 12-hour time confirms "18:30" and then sees "6:30 pm" on the chip. Same
   datum, two notations, across one tap boundary.
2. **Min-time validation is date-granular only.** `isDisabled()` (L54–63) floors both the cell and
   `minDate` to midnight — it disables past *days* but never invalid *times*. With `min = now + 60min`,
   a user at 5 PM can select today + 17:30 via the steppers, tap Confirm, and the client happily
   emits a `scheduledFor` the backend will 422 (`rides.service.ts` L221–226). The hour wrap
   `(h+1)%24` (L199) even lets midnight-crossing produce a time earlier than now on the selected
   day. The picker must clamp/disable times below `min` on the min day (and above `max` on the max
   day), not just days.
3. **Stale state on reopen.** All picker state (`viewY/viewM/selDay/hour/minute`, L37–43) is
   initialized from `value ?? minDate` **once at first mount** — the component stays mounted
   (`AnimatePresence` gates only the JSX) so `useState` initializers never re-run. Reopen the
   picker 30 minutes later, or after tapping "Ride now" (value → null), and it shows the stale
   snapshot; `minDate` has also drifted forward while `hour/minute` haven't. Needs a resync on the
   `open` false→true transition (a `useEffect` on `open`, or `key`-based remount).
4. **Tap targets below every platform minimum.** The stepper buttons are `w-10 h-7` = **40×28px**;
   month-nav and close buttons are 32×32px. WCAG 2.2 SC 2.5.8 (AA) floor is 24×24 CSS px — the 28px
   height passes AA by 4px — but WCAG 2.5.5 (AAA), Apple HIG (44pt), and Material (48dp) all demand
   44–48px, and these are *primary* controls tapped repeatedly in a row
   ([WCAG 2.5.8 guide](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide),
   [Adrian Roselli on 2.5.5](https://adrianroselli.com/2019/06/target-size-and-2-5-5.html),
   [LogRocket — touch target sizes](https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/)).
   Repeated-tap steppers at 28px tall with 6px gaps are a mis-tap machine.
5. **Zero accessibility semantics.** The sheet has no `role="dialog"` / `aria-modal`, no focus
   trap, no Escape handling; every icon-only button (close, month chevrons, all four steppers) has
   no `aria-label`; day cells don't expose `aria-pressed`/`aria-selected`; there is no keyboard or
   native-input path at all (no `<input type="datetime-local">` fallback for hardware-keyboard or
   assistive-tech users).
6. **Duplicated business constants.** `MIN_ADVANCE_MINUTES`/`MAX_ADVANCE_DAYS`
   (`ScheduleRideSheet.tsx` L6–7) shadow `api/src/constants/limits.ts`. If ops raises the max to
   14 days server-side, the client silently caps at 7. (No shared runtime package exists yet per
   `CLAUDE.md`, so the pragmatic fix is exposing the limits on an existing config/pricing endpoint
   response, or at minimum a single `apps/user/lib/constants.ts` with a comment pinning it to the
   API file.)
7. **Redundant double-close.** `DateTimePickerSheet.confirm()` (L70–73) calls `onConfirm` then
   `onClose`; `ScheduleRideSheet`'s `onConfirm` (L64) also calls `onClosePicker()`. Harmless today,
   but it means close runs twice and any future close-side-effect will fire twice.
8. **Naming.** `ScheduleRideSheet` renders a card, not a sheet. Rename in the redesign
   (`SchedulePill` / `PickupTimeChip`) so the file system stops lying.
9. **`select-ride/page.tsx` still has a second, fully-interactive edit point.**
   `SCHEDULE_UX_PLAN.md` §4 step 3 specifically called for this screen to show a **read-only summary
   chip** (tap to reopen the picker) once `scheduledFor` arrives via query param from `/search` or
   `/round-trip` — not a second live toggle. It was never converted; L258–267 mounts the same
   interactive `ScheduleRideSheet` as the originating page, so the value can be silently re-edited
   twice on the way to booking. The redesign in §4 below (a single chip component reused everywhere)
   closes this automatically, but call it out explicitly since the prior doc flagged it and it's
   still open.
10. **No explicit BullMQ job cleanup on user cancel.** `rides.service.ts` L597–602 flips
    `ride_advance_meta.status` to `'cancelled'` on a before-dispatch cancel but never calls
    `.remove()` on the stored `dispatch_job_id`, unlike the literal spec in
    `ADVANCE_BOOKING_PLAN.md` §6.2. The dispatch processor's CAS (`updateRideStatusCAS('scheduled',
    'requested')`) makes this safe — the zombie job no-ops when it fires — so it's not a correctness
    bug, just Redis hygiene. Frontend-adjacent only insofar as it's a one-line addition to the same
    cancel path the "Cancel ride" button on the Upcoming tab calls; noted here so it isn't lost.

---

## 4. Redesign spec

### 4.1 Interaction model (the decision)

**Trigger: one compact chip. Picker: quick-picks first, full picker only on demand. Kill the month
calendar entirely.**

```
TRIGGER (all 3 pages)                    PICKER — Stage 1 (default, compact)
┌────────────────────────┐               ┌──────────────────────────────────┐
│ 🕐 Now ▾               │  ── tap ──▶   │  ── handle ──                    │
└────────────────────────┘               │  Pickup time                     │
   (h-9 chip, auto width)                │  ┌─────────────────────────────┐ │
                                         │  │ ⚡ Now                    ✓ │ │
when scheduled:                          │  │ 🕐 In 1 hour   (7:30 pm)    │ │
┌────────────────────────────┐           │  │ 🌙 Tonight, 9:00 pm         │ │
│ 🕐 Wed 6:30 pm        ✕   │           │  │ ☀ Tomorrow, 8:00 am         │ │
└────────────────────────────┘           │  └─────────────────────────────┘ │
   (indigo-tint chip, ✕ = back to Now)   │  Choose another time  ›          │
                                         └──────────────────────────────────┘
                                                      │ tap "Choose another…"
                                         PICKER — Stage 2 (expands in place)
                                         ┌──────────────────────────────────┐
                                         │ ‹ Pickup time                    │
                                         │ [Today][Tomorrow][Fri 11][Sat 12]│  ← 8-chip day strip,
                                         │ [Sun 13][Mon 14][Tue 15][Wed 16] │    horizontal scroll
                                         │ ──────────────────────────────── │
                                         │  6:30pm 6:45pm 7:00pm 7:15pm …   │  ← 15-min slot grid,
                                         │  7:30pm 7:45pm 8:00pm 8:15pm     │    12-hour labels,
                                         │  …(scrolls)…                     │    <min slots hidden
                                         │ [ Confirm — Wed, 6:30 pm ]       │
                                         └──────────────────────────────────┘
```

**Why this shape:**
- Quick-picks-first matches Uber/Ola's chip-led model and current time-picker guidance
  (presets for the common case, full control for the tail —
  [Eleken](https://www.eleken.co/blog-posts/time-picker-ux), [Mobbin](https://mobbin.com/glossary/time-picker)).
  The two dominant intents — "later today" and "tomorrow morning" — become **2 taps total**
  (open → pick), down from 6–12.
- The **day strip replaces the calendar** because the domain makes a calendar indefensible: with a
  7-day max there are exactly 8 candidate days. Eight chips need no month navigation, no disabled
  ocean of cells, no `viewY/viewM` state at all.
- **Slot grid replaces steppers** because pickup times are not precision inputs — 15-minute
  granularity matches how dispatch actually works (the backend dispatches on a 15-min buffer
  anyway) and turns time entry into one tap. Slot lists are the recommended variant for
  fixed-interval booking systems ([Mobbin](https://mobbin.com/glossary/time-picker)). If product
  insists on minute precision later, swap the grid for a CSS `scroll-snap` wheel (hour / minute /
  AM–PM columns) — still no steppers, no new dependency.
- Stage 1 is a **short sheet** (~300–320px), honoring NN/g's size-follows-task guidance
  ([NN/g](https://www.nngroup.com/articles/bottom-sheet/)); Stage 2 grows the *same* sheet rather
  than stacking a second modal.

### 4.2 Trigger visual spec (`PickupTimeChip`, replaces `ScheduleRideSheet`'s card)

- **Shape:** single `h-9` (36px) pill, auto width (`inline-flex items-center gap-1.5 px-3.5`),
  `rounded-full`. Delete the boxed card, the `#F5F7FF` background wrapper, and the `PICKUP TIME`
  label row entirely. Net vertical reclaim: ~54px on every booking screen.
- **Unset state:** white bg, `border border-slate-200`, `Clock size={14}` in the existing icon
  slate, label `Now` `text-[13px] font-semibold text-slate-700`, trailing `ChevronDown size={12}`.
  This makes it a sibling of the existing `/search` action pills (L537–554) — on `/search`,
  **merge it into that pill row** as a third pill (`Select on map · Add stops · 🕐 Now ▾`), deleting
  the separate L556–565 row. On `/round-trip` and `/select-ride`, keep its own row but left-aligned
  auto-width, not full-width.
- **Set state:** `bg-indigo-50 border-indigo-200 text-indigo-700` (`#EEF2FF`/`#C7D2FE`/`#4338CA`,
  the palette already used across the booking flow), label e.g. `Wed, 6:30 pm` (12-hour, always),
  trailing `X size={12}` hit-area-padded to ≥24px that calls `onChange(null)` without opening the
  picker. Tapping the chip body reopens the picker pre-staged to the current value.
- **Motion:** `whileTap={{ scale: 0.97 }}` with the page's existing `SPRING`
  (`stiffness 340, damping 30`); animate the set/unset color swap with a 150ms crossfade — no
  layout animation needed since width change is small.

### 4.3 Picker spec (`SchedulePickerSheet`, replaces `DateTimePickerSheet`)

**Container:** keep the existing sheet chrome exactly — scrim `rgba(15,23,42,0.55)`, `rounded-t-[28px]`,
slide-up `{ duration: 0.32, ease: [0.16,1,0.3,1] }`, safe-area padding, handle. It's good. Add
`role="dialog" aria-modal="true" aria-label="Choose pickup time"`, Escape-to-close, and focus the
first option on open.

**Stage 1 — quick picks (default):**
- Header: `Pickup time` (`text-[15px] font-bold #0F172A`) + one-line subtitle
  `At least 1 hour ahead · up to 7 days` (`text-[11px] #94A3B8`). This is the **only** place the
  label appears — the `timeLabel` prop and its duplication die with the old component.
- 4 rows, each **48px min-height** (`min-h-12`), full-width, `rounded-xl`, generated by a pure
  helper:
  ```typescript
  // apps/user/lib/schedule-quick-picks.ts
  export function getQuickPicks(min: Date): QuickPick[] {
    // min = now + MIN_ADVANCE_MINUTES, rounded UP to the next 15-min mark
    // 1. { label: 'Now',            value: null }
    // 2. { label: 'In 1 hour',      value: min,  sub: fmt12(min) }
    // 3. tonight 9:00 PM if ≥ min and before 10 PM, else skip → 'Tomorrow, 6:00 PM'
    // 4. { label: 'Tomorrow, 8:00 AM', value: tomorrow0800 }
  }
  ```
  Selecting any row **commits immediately and closes** — no confirm button in Stage 1. Current
  selection shows a trailing check, `bg-indigo-600 text-white` fill (reuse the existing active-pill
  treatment).
- Footer link-row: `Choose another time ›` (`text-[13px] font-semibold text-indigo-600`, 44px
  hit area) → Stage 2.
- Sheet height ≈ 320px.

**Stage 2 — day strip + slot grid:**
- Same sheet **grows in place**: animate via Framer Motion `layout` on the sheet body or
  `animate={{ height }}` on a measured wrapper, 0.28s same ease. Back chevron (`‹`, 44px target,
  `aria-label="Back to quick options"`) returns to Stage 1 with the mirrored transition
  (`AnimatePresence mode="popLayout"` between stage fragments).
- **Day strip:** horizontally scrollable row of up to 8 chips (`h-10 px-4 rounded-xl`,
  `snap-x snap-mandatory`), labels `Today`, `Tomorrow`, then `Fri 11` … Selected chip =
  `#4F46E5` fill/white text; others `#EEF2FF`/`#4F46E5` — identical treatment to the round-trip
  hour chips (`round-trip/page.tsx` L196–209), which users already know.
- **Slot grid:** 4-column grid of time chips (`h-10 rounded-lg text-[13px] font-semibold
  tabular-nums`), 15-minute steps, **12-hour labels** (`6:30 pm`), scrollable region max-height
  ~200px with `overflow-y-auto`. Generation: for the min day start at `ceil15(min)` (this fixes
  §3.3-2 structurally — invalid times are never rendered); for the max day stop at `max`; otherwise
  6:00 am–11:45 pm. Auto-scroll the grid so the first valid/selected slot is visible on entry.
- **Confirm bar:** keep the existing 52px gradient pill (`#4F46E5 → #7C3AED`,
  `active:scale-[0.98]`) but label it in 12-hour: `Confirm — Wed, 6:30 pm`. Disabled until a slot
  is chosen.
- Sheet height ≈ 460px — still shorter than today's calendar sheet.

**Props (drop-in for the existing call sites):**
```typescript
interface SchedulePickerSheetProps {
  open: boolean
  value: Date | null                 // null = "Now"
  min: Date; max: Date
  onChange: (d: Date | null) => void // called once; owner closes — fixes the double-close (§3.3-7)
  onClose: () => void
}
```
`PickupTimeChip` keeps the current `ScheduleRideSheet` prop surface (`value/pickerOpen/onOpenPicker/
onClosePicker/onChange`) so `search/round-trip/select-ride` page diffs stay one-line renames; the
`select-ride` `isReturnCab` clearing (L265) is untouched.

**Copy:** everywhere a scheduled time renders, one formatter:
```typescript
// apps/user/lib/format-pickup-time.ts
export function formatPickupTime(d: Date): string  // "Today, 6:30 pm" | "Tomorrow, 8:00 am" | "Wed 16, 6:30 pm"
```
Relative day words ("Today"/"Tomorrow") beat "9 Jul" for a ≤7-day horizon; 12-hour lowercase
meridiem matches the existing trigger label locale output. Use it in the chip, the confirm button,
and the Upcoming-tab cards (`history/page.tsx`) so the same ride never renders three date formats.

### 4.4 What deliberately does NOT change

- No home-screen "Reserve" tile — `SCHEDULE_UX_PLAN.md` §3's reasoning stands: schedule is a
  modifier on all three ride types, not a fourth product.
- No native `<input type="datetime-local">` as the primary UI (inconsistent styling across
  Android/iOS browsers), but see §5-5 for it as an accessibility fallback.
- No new libraries. Framer Motion + Tailwind + lucide-react cover everything above.
- No backend or API-contract changes; `scheduledFor` remains an ISO string on the booking request.

---

## 5. Small, real technical fixes (worth doing even if the redesign waits)

1. **12h/24h inconsistency** (§3.3-1): change `DateTimePickerSheet.tsx` L88 (and the L210/L239
   value boxes) to 12-hour with an am/pm marker, matching `ScheduleRideSheet.tsx` L22. One-line
   formatter swap. *Do first — user-visible, zero risk.*
2. **Time-of-day min validation** (§3.3-2): in `confirm()` (L70–73), reject/clamp when the
   composed `Date` `< min` or `> max`; visually disable sub-minimum times on the min day.
3. **State resync on open** (§3.3-3): `useEffect` on the `open` false→true edge re-deriving
   `selDay/hour/minute` from `value ?? (now + MIN)`, or remount via `key={open ? 'open' : 'closed'}`.
4. **Tap targets** (§3.3-4): steppers `w-10 h-7` → `w-12 h-11` (44px), month-nav/close `w-8 h-8` →
   `w-11 h-11` (or padded hit areas via a larger transparent wrapper). Meets Apple HIG/Material and
   WCAG 2.5.5, not just the 2.5.8 floor.
5. **A11y semantics** (§3.3-5): `role="dialog"`, `aria-modal`, `aria-label` on every icon-only
   button, Escape close, focus management. Optionally a visually-hidden
   `<input type="datetime-local">` mirroring the value as the assistive-tech path.
6. **Constant dedup** (§3.3-6): single frontend source for min/max (config endpoint or one pinned
   constants file consumed by chip + picker + quick-pick helper).
7. **Double-close** (§3.3-7): remove `onClose()` from `confirm()` OR the `onClosePicker()` from the
   parent's `onConfirm` — one owner.

---

## 6. Prioritized implementation checklist

Ordered by impact ÷ effort. Items 1–3 are shippable independently of the redesign.

| # | Item | Files | Effort |
|---|---|---|---|
| 1 | Fix 12h/24h inconsistency (confirm label + value boxes to 12-hour) | `DateTimePickerSheet.tsx` L88, L210, L239 | XS |
| 2 | Clamp/validate time-of-day against `min`/`max` in `confirm()`; disable invalid slots | `DateTimePickerSheet.tsx` L54–73 | S |
| 3 | Resync picker state on open; fix double-close | `DateTimePickerSheet.tsx`, `ScheduleRideSheet.tsx` L64 | S |
| 4 | **Trigger redesign:** replace boxed 2-pill card with `PickupTimeChip` (single chip, set-state ×, formatter); merge into `/search` action-pill row; left-align on the other two pages | new `PickupTimeChip.tsx`, `format-pickup-time.ts`; `search/page.tsx` L537–565, `round-trip/page.tsx` L219–230, `select-ride/page.tsx` L258–267 | M |
| 5 | **Picker Stage 1:** quick-pick sheet (`getQuickPicks` helper, 4 rows, tap-commits) replacing the calendar sheet as default | new `SchedulePickerSheet.tsx`, `schedule-quick-picks.ts` | M |
| 6 | **Picker Stage 2:** 8-chip day strip + 15-min slot grid + 12h confirm bar; in-place height transition; delete calendar grid, month navigator, steppers, and `DateTimePickerSheet.tsx` itself | `SchedulePickerSheet.tsx` | M–L |
| 7 | A11y pass: dialog semantics, aria-labels, focus trap, Escape, ≥44px targets throughout the new picker | `SchedulePickerSheet.tsx`, `PickupTimeChip.tsx` | S |
| 8 | Unify scheduled-time formatting on Upcoming cards with `formatPickupTime` | `history/page.tsx` | XS |
| 9 | Dedup MIN/MAX advance constants (config endpoint or pinned shared file) | `apps/user/lib/*`, optionally `api` config route | S |
| 10 | Mark `docs/ADVANCE_BOOKING_PLAN.md` §1 and `docs/SCHEDULE_UX_PLAN.md` §3–4 as shipped/superseded with a pointer to this doc | both docs (header note) | XS |

**Definition of done for the redesign (items 4–7):** booking "tomorrow 8 AM" takes exactly 2 taps
from any booking screen; the trigger occupies ≤40px of vertical space; no 24-hour time renders
anywhere in the user app; every interactive control in the picker is ≥44px; `DateTimePickerSheet.tsx`
is deleted.

---

## Sources

- [Uber Reserve — how it works](https://www.uber.com/us/en/ride/how-it-works/reserve/) ·
  [Uber Help — scheduling a ride in advance](https://help.uber.com/riders/article/scheduling-a-ride-in-advance?nodeId=63165ec1-0910-409e-972f-0b8d8df1a605) ·
  [Uber Help — using Uber Reserve](https://help.uber.com/riders/article/using-uber-reserve?nodeId=71708d67-bbac-4dda-9d32-53c2509bdd1b)
- [Ola — Ride Later](https://help.olacabs.com/support/dreport/205018412) ·
  [Rapido scheduling feature study](https://medium.com/@corkidragon/scheduling-feature-for-rapido-1e1ed0b82313)
- [Eleken — Time Picker UX: best practices 2026](https://www.eleken.co/blog-posts/time-picker-ux) ·
  [Mobbin — time picker patterns](https://mobbin.com/glossary/time-picker) ·
  [Mobbin — date picker patterns](https://mobbin.com/glossary/date-picker)
- [Material 3 — time pickers](https://m3.material.io/components/time-pickers/) ·
  [Material 3 — date pickers](https://m3.material.io/components/date-pickers)
- [NN/g — Bottom Sheets: definition and UX guidelines](https://www.nngroup.com/articles/bottom-sheet/)
- [WCAG 2.5.8 implementation guide](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide) ·
  [Adrian Roselli — Target Size and 2.5.5](https://adrianroselli.com/2019/06/target-size-and-2-5-5.html) ·
  [LogRocket — accessible touch target sizes](https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/)
