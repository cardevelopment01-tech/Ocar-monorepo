# Admin uploads driver documents on the driver's behalf — plan

Status: **plan only, nothing built.** Source: client sheet "OCAR Bugs & Correction Tracking", admin row "Document Upload and Attachment Approval". Trigger: a driver could not upload properly and had to call support.

## 1. What exists today (researched)

| Piece | Where | Notes |
|---|---|---|
| Driver upload | `drivers.routes.ts` `/onboarding/documents/{upload-init,upload-complete,vehicle-upload-init,vehicle-upload-complete}` | Two steps: presigned S3 PUT to `uploads/pending/drivers/{id}/…`, then complete → `promotePendingUpload` → upsert row. 10 MB, jpeg/png/pdf. |
| Identity docs | `driver_documents`, unique `(driver_id, doc_type)` | `profile_photo, driving_license(_front/_back), aadhaar_front/back` |
| Vehicle docs | `driver_vehicle_documents`, unique `(vehicle_id, doc_type)` | `vehicle_rc_front/back, insurance, permit, pollution_cert, fitness_cert`. Needs a vehicle row first. |
| Upsert | `upsertDriverDocument` / `upsertVehicleDocument` | Replace = overwrite file, `status='pending'`. No history of the old file. |
| Admin review | `PATCH /admin/drivers/documents/:docId/{approve,reject}`, `DocReviewModal.tsx` | Optimistic lock (`seenUpdatedAt`), verified expiry (required except no-expiry types), audit log, then `syncDriverStatusAfterDocChange`. |
| Status sync | `syncDriverStatusAfterDocChange` | `docs_rejected → active` once all required docs approved; revokes `active → docs_rejected` otherwise. Does **not** move `pending_docs → pending_approval`. |
| Roles | approve/reject: `super_admin`, `ops_admin` | |
| Audit | `recordAuditLog` (queued) | |

## 2. Gaps that matter

1. **No admin upload path at all.** Only the driver's own token can write documents (`assertKeyBelongsToDriver` is tied to the driver id, which is fine and reusable).
2. **A driver still in onboarding stays stuck.** If support fills in the documents for someone in `pending_docs`, nothing moves them to `pending_approval`; only the driver's `submitApplication` does that. Admin upload must trigger the same check.
3. **`profile_photo` is special.** Uploading it also sets the reference selfie that daily identity verification compares against. An admin swapping it silently would weaken that check.
4. **No provenance.** Nothing records who put a file there. An admin who uploads and approves their own upload is a fraud path with no trail.
5. **Browser PUT to S3 needs CORS.** The driver app uploads natively; the admin portal would upload from a browser. No S3 CORS rule exists in `infra/terraform`. Either add one for the admin origins or proxy through the API (multer is already a dependency).

## 3. Proposed behaviour

**Who:** `super_admin` and `ops_admin` (same as approve). Support-only admins cannot.

**Where in the UI (driver detail → Documents tab, and the review modal):**
- Every document row gets a quiet **Upload / Replace** action. Missing documents show a prominent **Upload for driver** button in place of the grey "not uploaded" state.
- Clicking opens a right-hand **drawer** (not a modal, so the driver's other documents stay visible):
  1. **Document**: pre-selected from the row; vehicle documents are disabled with an explanation if the driver has no vehicle yet.
  2. **File**: drag-and-drop or pick; image preview or PDF first page; 10 MB limit and file type checked before upload; progress bar; retry on failure.
  3. **Details**: expiry date (required for types that need one), document number for vehicle documents.
  4. **Why**: required reason (preset chips: "Driver could not upload", "Poor photo quality", "Sent by WhatsApp/email", "Other") plus optional support ticket or call reference. Stored in the audit log.
  5. **Action** (two buttons): **Upload for review** (leaves it pending) and **Upload & approve** (only enabled once the expiry is filled; for `profile_photo` it shows an extra confirm: "This also becomes the driver's reference selfie for daily verification").
- If the slot already holds an **approved** document, the drawer opens with a warning banner: "This replaces an approved document", showing the current file side by side.
- Uploaded-by-admin documents carry a small **"Uploaded by <admin name> · <date>"** tag on the row and in the review modal, so reviewers and auditors can tell them apart from driver uploads.
- After success: toast, row refreshes, the modal's `seenUpdatedAt` is refreshed (the existing focus-refresh logic handles this), and if that completed the set the header shows "All required documents approved / submitted".

**Driver-facing effect:** push + in-app notification "Our team updated your documents" (via `notifyOwner`), so the driver is not surprised and refreshes the document gate (it already refreshes on focus, #188).

## 4. Backend design

New admin routes (reuse driver-side helpers, do not duplicate):

```
POST /api/v1/admin/drivers/:id/documents/upload-init
     { kind: 'driver'|'vehicle', doc_type, content_type, content_length }
     -> { upload_url, key }          // same pendingKey() under uploads/pending/drivers/:id/

POST /api/v1/admin/drivers/:id/documents/upload-complete
     { kind, doc_type, key, valid_until?, doc_number?, reason, ticket_ref?,
       approve: boolean, verified_valid_until?, seen_updated_at? }
     -> { doc, status, driver_status }
```

`upload-complete` does, in order:
1. Verify the key belongs to that driver; verify the driver exists and is not `banned`/`deleted`.
2. If replacing an existing row and `seen_updated_at` is sent, reject a stale one with the existing 409 `DOC_CHANGED`.
3. Call the existing `completeDriverDocumentUpload` / `completeVehicleDocumentUpload` (S3 promote + upsert).
4. If `approve`, call the existing approve path with the fresh `updated_at` (same expiry validation, same audit record).
5. If the driver is `pending_docs` and `checkDocuments` is now complete, run the same transition as `submitApplication` (status history reason "Completed by admin").
6. Run `syncDriverStatusAfterDocChange` so `docs_rejected` drivers reactivate.
7. `recordAuditLog` action `driver_documents.admin_upload` with before/after file, reason, ticket ref.
8. Notify the driver (failures must not 500, like `afterDocChange`).

**Migration (next free number on main at build time; 141 is already used):** add `uploaded_by_admin_id BIGINT REFERENCES admins(id) NULL` to both document tables. Null means the driver uploaded it. This is additive and safe.

**Hardening:** per-admin rate limit on upload-init; confirm content type by magic bytes on complete (the presigned URL only trusts the declared type); never expose raw S3 URLs, only `getPresignedUrl`; `error.message` stays out of responses per the project rule.

## 5. Decisions needed from you

1. **Two-person rule?** Option A (recommended for speed): `ops_admin` can upload and approve in one step, always audited with a reason. Option B: an admin can upload, but approval must be by a different admin. B is safer against fraud, slower for support.
2. **Profile photo:** allow admin to upload it (with the extra confirm), or exclude it so only the driver can set their reference selfie?
3. **Upload mechanism:** add an S3 CORS rule for the admin origins (clean, matches the driver flow) or proxy the file through the API (no infra change, 10 MB through the server). I lean to CORS; it needs a Terraform change reviewed for prd.
4. **Replacing an approved document:** allowed with a warning (proposed), or blocked until the admin rejects it first?

## 6. Build order (stacked PRs, each shippable)

1. Migration + two API routes + service + tests (upload for review, upload & approve, stale conflict, banned driver, pending_docs transition).
2. Admin UI drawer and row actions, "uploaded by admin" tag, unit tests.
3. S3 CORS (or proxy) change and a real-browser check on staging.
4. Driver notification copy and a short ops runbook entry.

## 7. Test plan

- API: unit and HTTP tests for every branch in section 4; replace on an approved doc; vehicle doc without a vehicle returns 422; wrong driver's key returns 403; role check.
- UI: drawer validation (size, type, expiry, reason), failure and retry, replace-approved warning, profile-photo confirm.
- Manual on staging with a throwaway driver: upload each of the 10 document types, confirm status transitions for `pending_docs`, `docs_rejected` and `active` drivers, and confirm the driver app picks up the change.

## 8. Not in scope

Document history (keeping old files), bulk upload for many drivers, and OCR of document numbers.
