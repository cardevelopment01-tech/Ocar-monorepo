# Driver Document Rejection & Status Transition: Client Feedback

## Resolution (2026-07-09)

Point 2 fixed: admin UI (drivers page decision panels + `DocReviewModal` header)
now exposes an "Approve Driver" action when `status === 'docs_rejected'`, alongside
the existing "Ban Driver" action. Backend already allowed `docs_rejected → active`
(see analysis below); the gap was purely that no UI control offered it.

Note: the driver-side resubmission flow already auto-transitions
`docs_rejected → pending_approval` once the driver completes the onboarding wizard
again and hits the final selfie/submit step (`ReferenceSelfie.tsx` →
`onboardingApi.submitApplication()` → `admin.service.ts` has no status guard blocking
this). The new "Approve Driver" button on `docs_rejected` covers the case where admin
wants to approve directly without waiting for the driver to run through that full flow.

Point 1 verified as working: `rejection_note` is returned per-document and surfaced on
`Documents.tsx` (inline per-slot) and `PendingReview.tsx` (dedicated rejected-docs list).
Delivery is poll-based (30s interval + on-mount), not a push notification — real push/SMS
requires the M10 Notifications module (`013_messaging.sql`), which is still a backend stub
per `CLAUDE.md`. Out of scope for this fix.

## Client feedback (verbatim intent)

1. When a driver uploads documents and admin reviews them, if a document is found invalid,
   admin adds a remark asking the driver to resubmit that document. This remark/notification
   needs to reach the driver on the driver app.
2. Once admin marks a driver as rejected due to invalid documents, after the driver resubmits
   valid documents, there is no option to change the driver's status back from rejected to
   active.

## Current state (as of 2026-07-09 investigation)

### Point 1: rejection remark reaching the driver

Appears to already be implemented:

- `driver_status` enum includes `docs_rejected` (`api/src/db/migrations/017_docs_rejected.sql`),
  distinct from `suspended`/`banned`.
- Per-document `status` + `rejection_note` fields are returned to the driver
  (`api/src/modules/drivers/drivers.service.ts:222-223`).
- Driver app reads and displays this: `apps/driver/src/pages/Onboarding/Documents.tsx`,
  `apps/driver/src/pages/Onboarding/PendingReview.tsx`.
- Admin rejection resets `onboarding_step` to `'documents'` so the driver lands back on the
  upload screen (`api/src/modules/admin/admin.service.ts:66`).

**TODO before dismissing this point:** verify end-to-end in the running app. Confirm the
rejection note is actually visible to the driver (not just present in the API response), and
confirm there's an actual notification (push/in-app banner) rather than the driver only seeing
it if they happen to reopen the onboarding screen.

### Point 2: rejected → active transition

Backend does **not** block this transition:

```ts
// api/src/modules/admin/admin.service.ts:59-63
const backwardTransitions = new Set(['pending_docs', 'pending_approval', 'docs_rejected'])
if (currentStatus === 'active' && backwardTransitions.has(payload.status)) {
  throw createHttpError(AppErrors.VALIDATION_ERROR)
}
```
This only blocks moving *out of* `active` backward. `docs_rejected -> active` (or
`-> pending_approval`) is allowed by `VALID_STATUSES` (line 8) and not blocked by the guard
above.

**Likely actual gap: the admin UI.** The backend allows the transition, but the admin driver
detail screen's status-change control probably doesn't expose `active` (or `pending_approval`)
as a selectable option when the driver's current status is `docs_rejected`/`rejected`.

## Next steps

1. Check `apps/admin` driver detail slide-over (driver status change control): confirm whether
   it restricts which target statuses are selectable based on current status, and whether
   `docs_rejected -> active` / `docs_rejected -> pending_approval` is actually offered.
2. If missing, add `docs_rejected` as a valid "from" state that can transition to
   `pending_approval` (send back to admin review queue) or directly to `active` in the admin UI.
3. Manually test the full loop end-to-end:
   - Admin rejects a specific document with a remark.
   - Driver app shows the remark / notifies the driver.
   - Driver resubmits the document.
   - Admin can move driver status forward again (to `pending_approval` or `active`).
4. Decide product behavior: should resubmission auto-move driver to `pending_approval` for
   re-review, or should admin manually re-approve to `active` directly? (Affects whether this is
   a UI-only fix or needs a service-layer change too.)

## Relevant files

- `api/src/db/migrations/017_docs_rejected.sql`
- `api/src/modules/admin/admin.service.ts` (`updateDriverStatus`, `VALID_STATUSES`,
  `backwardTransitions`)
- `api/src/modules/drivers/drivers.service.ts` (document status / rejection_note shape)
- `apps/driver/src/pages/Onboarding/Documents.tsx`
- `apps/driver/src/pages/Onboarding/PendingReview.tsx`
- `apps/admin`, driver detail slide-over / status change UI (not yet located, check here first)
