# Critique: Admin — Document Review Modal
**Target:** `apps/admin/components/ui/DocReviewModal.tsx` + `apps/admin/app/(dashboard)/drivers/page.tsx`
**Date:** 2026-06-23
**Slug:** `apps-admin-doc-review-modal`

---

## Heuristic Scores

| Dimension | Score | Note |
|---|---|---|
| Efficiency | 4/10 | No auto-advance after approval; no keyboard shortcuts for actions; no batch approve |
| Error prevention | 6/10 | Reason forms require 10-char min; but single-click Approve with no confirmation |
| Feedback | 5/10 | No optimistic sidebar update after doc action; waits for full parent refresh cycle |
| Visibility of state | 7/10 | Progress bar and status dots are clear; doc counter includes missing docs (misleading) |
| Flexibility | 3/10 | Binary zoom only (fit / actual size); no PDF inline preview; no ← → action shortcuts |
| Consistency | 6/10 | Action bar height shifts when forms appear; header actions absent for `docs_rejected` state |
| Aesthetics | 5/10 | Two banned design patterns; sub-10px text; overall layout works but has craft violations |

**Overall: 5/10**

---

## P0 — Blockers

None. Core callbacks are fully wired: `onDriverDocApprove`, `onDriverDocReject`, `onVehicleDocApprove`, `onVehicleDocReject` all fire correctly and the parent refreshes `detail` after each call, so status updates reach the modal.

---

## P1 — High Priority (significantly degrades core workflow)

### 1. No auto-advance after document approval/rejection
After `doDocApprove()` completes, the modal stays on the same document index. An admin reviewing 7 documents must manually click Next after each approval — 7 extra clicks per driver review. Should auto-advance to the next non-approved document after each approve action.

### 2. PDF documents cannot be previewed inline
When a document is a PDF (`/\.pdf(\?|$)/i`), the preview area shows a placeholder icon and an "Open PDF" link that opens in a new tab. Admins must leave the modal context to review PDFs. Modern browsers support `<iframe src="...">` or `<embed>` for inline PDF rendering without any library dependency.

### 3. No keyboard shortcuts for approve/reject actions
Arrow keys work for navigation (← →), and Escape closes the modal. But there are no shortcuts for the primary actions. An admin reviewing 50+ documents per day would benefit significantly from:
- `A` → approve current doc
- `R` → reject current doc (open reason form)
- `Enter` → submit reason form when focused

---

## P2 — Medium Priority (noticeable friction or craft violations)

### 4. Zoom is a binary toggle, not real zoom
`zoomFit: boolean` switches between "fit to window" and "actual size" (natural pixel dimensions). There is no:
- Mouse wheel / trackpad scroll-to-zoom
- Multi-step zoom (50% / 75% / 100% / 150% / 200%)
- Zoom level indicator showing current scale
- Pinch-to-zoom for tablet/touchscreen

For verifying document authenticity (checking watermarks, text sharpness on an Aadhaar), actual vs fit is insufficient. Need true zoom with steps.

### 5. Sub-10px text violates WCAG minimum
```tsx
// Line 357, 361 — sidebar section labels
<p className="... text-[9px] ...">Identity</p>
<p className="... text-[9px] ...">Vehicle</p>

// Line 103 — sidebar doc status
<p className={cn('text-[10px] mt-0.5 ...')}>{...}</p>

// Lines 344-349 — sidebar identity fields
<span className="text-[10px] text-text-muted ...">Aadhaar</span>
<span className="font-mono text-[10px] text-text-secondary ...">
```
`text-[9px]` = 9px — WCAG SC 1.4.4 recommends minimum 12px for readability. 9px is not legible at arm's length. Minimum should be 11px for data labels, 12px for any readable content.

### 6. Side-stripe border — banned pattern
```tsx
// Lines 74-79 — SidebarDoc
className={cn(
  'group w-full flex items-center gap-3 px-3 py-2.5 text-left border-l-2 transition-all duration-100',
  selected
    ? 'bg-primary/8 border-l-primary'
    : 'border-l-transparent hover:bg-black/4 hover:border-l-border'
)}
```
`border-l-2` with `border-l-primary` as a selected-state indicator is the banned side-stripe. Replace with: full background fill (`bg-primary/10`), a leading icon color change, or no border indicator at all — the background tint alone is sufficient.

### 7. Eyebrow labels on sidebar sections — banned pattern
```tsx
// Line 357, 361
<p className="px-3 pt-3 pb-1.5 text-[9px] font-black text-text-muted uppercase tracking-widest">Identity</p>
<p className="px-3 pt-3 pb-1.5 text-[9px] font-black text-text-muted uppercase tracking-widest">Vehicle</p>
```
`font-black uppercase tracking-widest` is the banned eyebrow pattern. These section dividers should use regular weight, normal case, or be implicit (visual divider line only).

### 8. No optimistic sidebar update after doc action
When `doDocApprove()` is called, `docLoading` is set to true but the sidebar item still shows the old status dot (e.g. amber "pending") until the parent completes `adminDriverApi.getById()` and passes the updated `detail` prop back down. On a slow connection this creates a 1–2s lag where the action appeared to do nothing.

### 9. Missing docs inflate the navigation counter
`allDocs.length` includes missing document stubs. A driver with 4 of 7 documents uploaded shows `1 / 11` in the nav counter. The `11` includes 4 documents the admin cannot act on. Counter should show uploaded count only, or clearly label missing separately.

### 10. `docs_rejected` driver state has no modal actions
The header (`line 281-314`) shows actions for `pending_approval`, `active`, and `suspended` only. When `detail.status === 'docs_rejected'`, the header action area is empty — there's no way to ban from the modal for a driver in this state. The slide-over's Documents tab handles this correctly (shows a Ban button), but the modal doesn't mirror it.

---

## P3 — Low Priority

- **No zoom level display.** When in actual-size mode, show current scale (e.g. "100%") near the zoom button so the admin knows how zoomed in they are.
- **No confirmation on single-click Approve in header.** "Approve Driver" in the header fires immediately on click (`doDriverAction('approve')`) with no confirmation step. Per-doc approve (individual documents) is lower stakes, but promoting an entire driver is significant.
- **Nav counter position.** The nav counter (`1 / 11 ← →`) is in the action bar, visually grouped with doc action buttons. It reads as if the arrows are related to the doc actions. It would be clearer anchored to the preview area (e.g. top-center overlay, like a lightbox).

---

## Persona: Ops Admin (reviewing 20–50 driver applications per day)

Red flags this persona would hit:

1. Clicks "Approve" on Driving Licence → nothing appears to change in the sidebar → clicks it again → error (already approved). *(No optimistic update)*
2. Opens PDF Aadhaar → "PDF, can't preview inline" → opens in new tab → loses modal context, has to reopen slide-over to continue. *(No inline PDF)*
3. Reviews 7 documents, approves each one, then realizes they need to manually advance after every single action — approximately 14 mouse movements per driver vs 7 possible. *(No auto-advance)*
4. Wants to zoom into the fine print on an RC Book to verify the number plate — binary zoom jumps from "tiny stamp" to "giant uncropped image that overflows the preview area". *(No real zoom)*

---

## Implementation Priority Order

Given the user wants to fix issues one by one, recommended order:

1. **Real zoom** (P2 #4) — most visible quality-of-life; affects every image review
2. **Auto-advance after approve/reject** (P1 #1) — biggest workflow speedup; 2 lines of code
3. **PDF inline preview** (P1 #2) — unblocks a whole category of docs from review
4. **Keyboard shortcuts A/R** (P1 #3) — power-user layer on top of working UI
5. **Remove side-stripe / fix eyebrows** (P2 #6, #7) — design cleanup, low risk
6. **Fix sub-10px text** (P2 #5) — readability compliance
7. **Optimistic sidebar update** (P2 #8) — UX polish
8. **Nav counter scope** (P3 last) — minor clarification

User stated immediate concerns: zoom + approval system integration.
Items 1-2 directly address those.
