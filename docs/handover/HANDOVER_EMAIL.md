# Handover Email — ready to send

Fill the `<ANGLE BRACKET>` placeholders before sending.
Do not paste credentials into this email — see "Access" below.

---

**To:** \<reviewer email\>
**Cc:** \<your project lead\>, \<client contract owner\>
**Subject:** Ocar — infrastructure & delivery handover: documentation and access

---

Hi \<Name\>,

Attached is the complete infrastructure and delivery documentation for the Ocar platform, and the
access details are set out below.

**`OCAR_INFRASTRUCTURE_HANDOVER.pdf` — 61 pages.** It covers the system architecture, the CI and
CD pipelines end to end, the deployment strategy and why it was chosen over blue/green and canary,
request distribution and routing rules, how to add and remove capacity, how to change instance
types, configuration and secret management, twelve numbered operational procedures, and a register
of known gaps.

Every value, filename, job name and command in it was verified directly against the repository at
commit `<COMMIT SHA>` on `<DATE>` — not written from memory. Where a behaviour depends on an AWS
semantic rather than on our code, it was checked against AWS's own documentation rather than
inferred. Section 18(D) lists which files were read in full, so anything can be verified quickly.

Two sections I'd point you to first:

**Section 14** is the operational reference — twelve procedures (`OPS-01` to `OPS-12`) covering
deploys, rollback, scaling, instance-type changes, secret rotation, staging, and diagnosing a
failed deploy. Each states its blast radius and how to reverse it. That's the section to work
from rather than the narrative chapters.

**Section 17** documents eighteen known gaps, six of them high severity, with a suggested order of
work. These are disclosed deliberately. You'd find them yourself soon enough with the access
you're getting, and we'd rather you have the list from us, with the reasoning already attached.

---

## Access

Neither credential is being sent in this email. Email is unencrypted at rest, forwards trivially,
and persists indefinitely in both mailboxes — and it would sit oddly with a document whose central
claim is that this system holds no long-lived credentials anywhere.

**GitHub.** An invitation to `cardevelopment01-tech/Ocar-monorepo` has been sent to
`<their GitHub account>` at `<role>` level. Nothing is transferred — it binds to your own account
and your own 2FA. Please accept from the account you intend to use.

**AWS.** Provisioned in `ap-south-1` as `<IAM role assumption / IAM user with console sign-in URL
and forced password reset>`. Sign-in details follow separately via `<channel>`.

On scope, since "Owner" was the phrase used: AWS has no role by that name — that's Google Cloud
terminology. The AWS equivalents are the **root account**, which is bound to the account's
registered email address and can't be delegated, and **`AdministratorAccess`**, which is full
control over every resource and service. You're getting the latter, which is what running
operations independently actually requires. Root stays with `<your company>` as account holder of
record.

---

## Before you start — four things worth knowing

**1. Three capabilities are currently unguarded.** Naming them explicitly rather than leaving them
to be found:

- The `staging-infra` workflow dispatched with `action: destroy` runs
  `terraform destroy -auto-approve` against real infrastructure — no approval step, no undo.
- There's no branch protection on `main`; a direct push bypasses review entirely.
- A merge to `main` touching `api/**` deploys to production automatically, with no human approval
  pause.

Documented as `G-05` and `G-06` with the exact remediation commands. All three need repository
admin rights to close, which is why they're still open.

**2. Production carries live data.** Real rider and driver records including phone numbers and
location history, and live payment-gateway credentials in the `api-env` parameter. Admin access
reads both. Load testing and anything destructive should go to staging — procedure `OPS-09`, and
note the blocker recorded against it. Production is taking real bookings and real payments.

**3. Everything is recorded, which cuts both ways.** CloudTrail logs every AWS API call with
identity, source IP and timestamp; git records every commit; Actions retains every workflow run.
That's how we diagnose an incident from evidence rather than recollection — and it's equally
available to you when you want to know what we did and why.

**4. This document is a snapshot, not a living spec.** It's accurate as at commit `<COMMIT SHA>`
and becomes less so as the system changes. If you change something material, the corresponding
section is superseded — please don't treat it as current indefinitely.

---

If anything in the document is unclear, contradicts what you find in the account, or is simply
wrong, I'd rather hear it than have you work around it. Same for anything in Section 17 you think
we've mis-prioritised.

Happy to walk through any of it on the call.

Best regards,

\<Your name\>
\<Title\>
\<Company\>
\<Contact\>

---
---

## Not for this email — route separately

The following were in the earlier draft and have deliberately been removed. They are commercial
terms, not technical handover content, and asserting them unilaterally in an engineer-to-engineer
email is both weaker and more likely to cause friction than routing them properly:

- **Transfer of operational custody / liability on first use of access.**
- **Support scope** — that defects in the delivered system are covered, while issues arising from
  changes made outside the delivery process are quoted separately.
- **A request for written acknowledgement** of the above.

If `<your company>` wants these on record, they should come from the contract owner as a short
handover-acceptance note referencing the executed agreement — not from the delivery engineer
inside a technical email. Only the agreement can shift liability or narrow support scope; an email
asserting it doesn't achieve that, and invites a dispute at exactly the wrong moment.

Worth noting: your practical protection here doesn't depend on the client agreeing to anything.
The 61-page document evidences what was delivered and what was disclosed, and CloudTrail plus git
history evidence who changed what and when. Both hold regardless.
