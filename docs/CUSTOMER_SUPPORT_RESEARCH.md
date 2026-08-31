# Customer Support for Ocar — Research & Recommendation

**Date:** 2026-08-24
**Prepared for:** management review
**Question:** How do Uber/Ola handle rider and driver support? Do we integrate a third-party
platform or build it ourselves?

---

## 00. Headline

Three things, in order of importance:

1. **A 24×7 control room is a legal licensing requirement for cab aggregators in India, not a
   product feature.** This changes the question from "what is the cheapest way to add support" to
   "what does the licence require us to have."
2. **Ocar already has roughly 60% of the technical plumbing built** — masked calling, SOS alerts,
   a disputes system, in-ride chat, and multi-channel notifications. All of it is the
   *agent-facing* layer, not the customer-facing one.
3. **Buy the helpdesk, extend the telephony we already have, build only the ride-context
   bridge.** Building a ticketing system from scratch would be re-implementing a mature commodity
   for no advantage.

---

## 01. The regulatory position — read this first

Under India's **Motor Vehicle Aggregator Guidelines**, a licensed aggregator must:

| Requirement | Implication for Ocar |
|---|---|
| Operate a **24×7 control room** with published telephone contact, capable of monitoring vehicle movement | Round-the-clock staffing, not business hours. An inbound phone line is mandatory. |
| Provide assistance in **English and the official state language** | Odia-language support for Odisha operations. |
| Appoint a **Grievance Officer**, with contact details **displayed in the app and on the website** | A named person, publicly listed. Currently absent from both. |
| Complete inquiry into a passenger complaint against a driver **within 3 days** | An SLA with a legal basis. Needs to be measurable and evidenced. |
| Maintain **₹5 lakh minimum passenger insurance** | Commercial/insurance workstream, outside this document. |

This is licence-conditional. The support function should therefore be scoped and budgeted as
compliance infrastructure with a customer-experience benefit attached, not as a discretionary
feature that can slip.

> **Action regardless of build/buy decision:** designate a Grievance Officer and publish the name,
> phone number and email in the app and on the website. This is the cheapest compliance item on
> the list and currently unmet.

---

## 02. How the large platforms actually do it

Uber's published engineering material describes a **three-tier funnel**, and the architecture is
worth copying even at a fraction of the scale:

**Tier 1 — In-app self-service.** A help centre with contextual, trip-aware guided flows,
surfaced contextually from trip ID, location and account history. Most fare disputes, refund
requests and lost-item reports start *and finish* here without ever becoming human-agent
contacts, and it is where the economics are won.

**Tier 2 — Live chat and email.** Escalation from self-service into an agent queue. Reported chat
response times average 2–4 minutes for riders and 5–7 minutes for drivers.

**Tier 3 — Direct phone line.** Deliberately restricted to safety incidents, active-ride issues,
premium driver accounts, merchants, and riders with verified accessibility needs.

Behind it, Uber runs ticket routing on a workflow orchestration engine (Cadence) with
prioritisation rules for user segment, safety flagging, and SLA — a purpose-built routing layer,
not a generic queue, supporting 30+ backend services behind the support platform alone.

**The transferable lessons, not the scale:**

- **Contact deflection is the entire economic game.** Every ticket that a help article resolves is
  an agent-minute never spent. At Uber's volume this is the difference between hundreds of agents
  and thousands of agents.
- **Context beats speed.** A ticket that arrives already carrying the ride ID, driver, fare
  breakdown and GPS trail is resolved in a fraction of the time of one that starts with "which
  trip was this?"
- **Phone is rationed deliberately.** Not because phone is bad, but because it is the most
  expensive channel per contact and should be reserved for the cases that actually need it —
  which, for us, is exactly the safety cases the control-room mandate covers.
- **Safety is a separate lane with its own routing.** It never waits behind a fare complaint.

Ola and Rapido follow broadly the same structure in the Indian market — in-app help
centre first, chat second, an emergency/SOS line kept distinct from general support.

---

## 03. What Ocar already has

This is the part that changes the build/buy maths. Verified against the codebase:

| Capability | Status | Where |
|---|---|---|
| **Masked calling** rider ↔ driver via Exotel | ✅ Live | `modules/call-masking/` — number pool, per-ride allocation, call-count limits, time limits, daily spend cap, event logging |
| **SOS alerts** with severity, acknowledge/resolve workflow | ✅ Live | `sos_alerts`, `sos_notifications`; admin SOS page |
| **Disputes** with messages, actions, evidence attachments | ✅ Live | `disputes`, `dispute_messages`, `dispute_actions`, `dispute_evidence`; admin disputes page |
| **In-ride chat** rider ↔ driver, real-time | ✅ Live | Socket.io, `ride_messages` |
| **Multi-channel notifications** SMS + push + in-app feed, templated | ✅ Live | `modules/notifications/`, `notification_templates`, Fast2SMS, FCM |
| **Ratings and rating tags** | ✅ Live | `modules/safety/` |
| **Admin portal** with driver, ride, payment and user data | ✅ Live | `apps/admin` |
| **Audit trail** on admin actions | ✅ Live | `admin_audit_log` (immutable), `user_audit_logs`, `driver_audit_logs` |

**We are not starting from zero.** The customer-facing primitives largely exist.

### What is genuinely missing

| Gap | Why it matters |
|---|---|
| **Agent console / omnichannel inbox** | The admin disputes page is an ops screen, not a support desk. No queues, no assignment, no SLA timers, no canned responses, no conversation history across channels. |
| **Ticketing with SLA and routing** | The 3-day statutory inquiry window needs to be tracked and evidenced, not remembered. |
| **Help centre / knowledge base** | **The single largest gap, and currently entirely absent.** Without Tier 1, every contact becomes an agent contact. |
| **Inbound phone line + IVR** | We have *outbound* masked calling between rider and driver. We do not have an inbound support number — which the control-room mandate requires. |
| **Support-agent role** | `admin_role` today is admin-only or nothing; there is no scoped role giving read access to ride/user data without pricing, payout or config powers. |
| **CSAT / resolution metrics** | No measurement of support quality exists today. |
| **Odia-language capability** | Statutory. Affects both staffing and any AI/canned-response layer. |

---

## 04. Build vs buy

### Building a helpdesk ourselves — the honest cost

A support desk is not one feature. It is: ticket lifecycle and state machine, queue and assignment
logic, SLA timers with escalation, agent console UI, canned responses, internal notes,
conversation threading across email/chat/phone, knowledge-base authoring and search, CSAT
collection, agent performance reporting, and role-based access control.

That is a product in its own right — realistically **3–5 engineer-months** just to reach a credible
first version, followed by permanent maintenance, on a team that currently has five test files and
eighteen open infrastructure gaps. It would also be strictly worse than a mature ₹800–2,000/agent/month
commodity product for at least two years.

**There is no competitive advantage in owning ticket routing.** Riders do not choose Ocar because
of its internal helpdesk.

### Buying — where it genuinely fits

Mature helpdesk platforms solve exactly this, are billing-ready, and can be live in weeks.
The trade-off is that customer conversation data lives with a vendor, and deep ride-context
integration requires custom work regardless of vendor.

### The recommendation: hybrid, weighted heavily to buy

| Layer | Decision | Reasoning |
|---|---|---|
| Ticketing, agent console, SLA, knowledge base | **Buy** | Commodity. No advantage in owning it. |
| Inbound voice, IVR, control room | **Extend Exotel** | Already an integrated, paid vendor. Same platform does contact centre as well as number masking. |
| **Ride-context bridge** | **Build** | ~1–2 weeks. No vendor can do this for us, and it is where the actual value is. |
| In-app "Help" entry points | **Build (thin)** | Deep-link into the vendor's SDK or a webview, pre-filled with ride context. |
| Safety/SOS escalation | **Keep in-house** | Already built, already wired into the admin portal. Should *not* be flattened into a normal support queue. |

---

## 05. Vendor landscape

### Helpdesk platforms — India pricing

Indicative per-agent/month, annual billing. **Verify directly with vendors before committing** —
list prices move and Indian pricing is often negotiable.

| Platform | Entry | Mid-tier | Notes |
|---|---|---|---|
| **Zoho Desk** | ₹420 (Express) | ₹800 (Standard) / ₹1,400 (Professional) | Indian company, INR billing, GST-compliant invoicing. Reported at 50–70% below Zendesk and Freshdesk equivalents. "Light agent" seats at ₹345, with 50 free on Enterprise — useful for ops staff who need read access only. |
| **Freshdesk** | — | ~₹1,200 (Growth) | Indian-origin (Freshworks), strong mid-market product, large integration ecosystem. |
| **Zendesk** | — | ~₹1,800 (Suite Team) | The enterprise-grade option with the deepest customisation and marketplace; the most expensive by a distance. |
| **Intercom** | Usage-based | — | Built around in-app messaging rather than ticket volume. Its Fin AI agent pioneered per-resolution pricing at $0.99; Zendesk's equivalent is around $2.00 per automated resolution. |

**Assessment for Ocar:** **Zoho Desk** is the strongest fit — same corporate entity for
support and contracting, materially cheaper, and the light-agent tier fits a small ops team well.
Freshdesk is the credible alternative if the integration ecosystem matters more than price.
Zendesk is hard to justify at this scale. Intercom's model suits product-led SaaS more than a
compliance-driven control room.

### Voice / control room

| Provider | Position |
|---|---|
| **Exotel** | **Already integrated** for number masking. Also offers a full contact centre — inbound IVR, agent seats, call recording, reporting. Plans reported from ~$70 (XPrime) and ~$100 (XPro). Extending an existing vendor avoids a second integration, a second contract and a second failure domain. |
| **Ozonetel** | Direct competitor, per-agent pricing, strong in omnichannel routing and speech analytics. Worth a quote as a negotiating comparison. |
| Knowlarity, MyOperator, Kaleyra, Plivo | Also credible in this market; secondary options. |

**Assessment:** extend Exotel. We already run their number pool, already handle their call events,
and already track spend against a daily budget. The marginal integration cost of adding inbound
support calling is far lower than onboarding a new telephony vendor.

---

## 06. Recommended architecture

```
TIER 1 — SELF-SERVE  (target: deflect 50–70% of contacts)
  In-app Help centre, contextual to ride state
  Articles: fare breakdown, cancellation policy, payment issues,
            lost item, driver behaviour, wallet/refund status
  Odia + English
        │  unresolved
        ▼
TIER 2 — ASSISTED  (Zoho Desk)
  In-app chat / email → ticket, auto-tagged with ride context
  Queues: rider · driver · payments · safety (priority)
  SLA timers; 3-day statutory clock tracked on driver-complaint tickets
        │  escalation / safety
        ▼
TIER 3 — VOICE  (Exotel contact centre — the statutory control room)
  24×7 inbound line, published in app + website
  IVR: 1 emergency · 2 ongoing ride · 3 payments · 4 other
  Emergency path bypasses queue entirely
        │
        ▼
SAFETY LANE  (existing, in-house — deliberately separate)
  SOS button → sos_alerts → admin SOS page + notify all admins
  Never queued behind fare complaints
```

### The bridge we build (the part that matters)

When a user taps **Help** on a ride, the ticket must be created already carrying:

```
ride_id · rider · driver · vehicle · fare breakdown (fare_snapshots)
payment status · GPS trail (gps_tracks) · ride status history
prior tickets for this user
```

An agent opening that ticket sees the whole picture immediately. This is the difference between a
90-second resolution and a 10-minute one, and it is the one piece no vendor can supply. Estimated
**1–2 weeks** of work: a webhook/API integration plus a signed context payload.

Also required: a **`support_agent` admin role** with read access to rides, users and drivers, and
the ability to issue bounded refunds — but no access to pricing, payouts or system config.
`admin_audit_log` already captures the actions.

---

## 07. Indicative cost

For a small operation covering 24×7 with 4–6 agents across shifts:

| Item | Monthly (₹) |
|---|---|
| Zoho Desk — 5 agents @ Standard ₹800 | 4,000 |
| Zoho Desk — 3 light agents @ ₹345 (ops read-only) | 1,035 |
| Exotel contact centre — seats + inbound minutes | 15,000–30,000 |
| Knowledge-base authoring (one-off, incl. Odia translation) | not recurring |
| **Recurring subtotal** | **≈ 20,000–35,000/month** |

Agent salaries dominate and are not included — 24×7 coverage needs roughly 4–5 FTE minimum, and
that is the real cost of the control-room mandate. **This is why the deflection number in Tier 1
matters:** every point of deflection is a direct reduction in required headcount.

Building in-house instead: 3–5 engineer-months up front (~₹6–12 lakh equivalent), plus ongoing
maintenance, plus opportunity cost against the load-test readiness work and the other
eighteen open infrastructure gaps.

---

## 08. Phasing

**Phase 0 — Compliance minimum (days, not weeks)**
Designate and publish a Grievance Officer in the app and on the website, with a support email
and phone number. This closes the most visible licensing gap at near-zero cost.

**Phase 1 — Buy and connect (2–4 weeks)**
Zoho Desk trial → email and chat channels live → `support_agent` role shipped → deep-link to help from the
rider and driver apps.

**Phase 2 — The bridge (1–2 weeks)**
Ride-context injection into every ticket. Highest value per engineering hour in this whole document.

**Phase 3 — Deflection (2–3 weeks)**
Knowledge base, 20–30 articles covering the top contact reasons, English and Odia, surfaced
contextually by ride state. Measure the deflection rate before and after.

**Phase 4 — Voice / control room (3–4 weeks)**
Extend Exotel to inbound. IVR tree. 24×7 rota. Emergency path bypassing the queue.

**Phase 5 — Measure**
CSAT, first-response time, resolution time, deflection rate, 3-day statutory compliance rate
on driver complaints. Route into the existing Grafana stack rather than a separate dashboard.

---

## 09. Open questions for management

1. **Staffing model** — in-house agents, BPO, or hybrid? This decides the platform seat count and
   is the largest cost line by far.
2. **Odia-language coverage** — required statutorily. Native-speaking agents, or translation
   support in the tooling?
3. **Support hours at launch** — the mandate says 24×7. Is there an agreed interim position with
   the licensing authority, or does day one require full coverage?
4. **Refund authority** — what value can a support agent approve without escalation? Determines
   the role's permission scope.
5. **Data residency** — Zoho and Freshdesk both offer Indian data centres. Should be specified in
   the contract given rider PII and ride history.

---

## 10. Sources

- Uber Engineering — [Architecting Uber Support with Customer Obsession](https://www.uber.com/us/en/blog/customer-obsession-engineering/)
- Uber Engineering — [Customer Obsession Ticket Routing, Workflow and Orchestration Engine](https://www.uber.com/us/en/blog/customer-obsession-ticket-routing-workflow-and-orchestration-engine/)
- [Motor Vehicles Aggregator Guidelines, 2025 — explainer](https://www.taxmann.com/2025/07/223-motor-vehicles-aggregator-guidelines-2025/)
- [PIB — Motor Vehicle Aggregator Guidelines](https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1676403)
- [Zoho Desk India pricing 2026](https://www.itforsme.com)
- [Freshdesk vs Zendesk 2026](https://www.helpdesk.com/blog/freshdesk-vs-zendesk/)
- [Telephony partners in India — Plivo/Exotel/Ozonetel comparison](https://caller.digital/blog/telephony-partner-voice-ai-india-plivo-exotel-ozonetel-knowlarity-twilio-2026)
- [Ozonetel — Exotel alternative](https://ozonetel.com)

*Pricing figures are indicative, drawn from published data at time of writing and must be
confirmed directly with each vendor before any commitment.*
