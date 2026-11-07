# DLT templates for live trip sharing

Two new SMS wordings need DLT approval before live trip sharing can text anyone. They ship **inactive** (migration 126) and the feature stays off (`system_config.trip_share_enabled = false`) until both are approved and activated.

Same entity and sender as the login OTP (template 193042, "OTP SMS", approved 2026-06-18). Variables are written `{#var1#}`, `{#var2#}` (numbered), as BulkSMSPlans accepts; if its form prefers plain `{#var#}`, use that in the same order.

The older SOS text below uses plain `{#var#}` because it is already written that way in the app.

| | |
|---|---|
| Entity | OD CAR RENTALS PRIVATE LIMITED |
| Header (sender ID) | ODCARI |
| Content type | Text (English, plain characters only: no emoji, no smart quotes) |

## Where the Template ID comes from

The DLT Template ID is issued by the **DLT portal** (the operator portal Ocar's entity is registered on: Jio, Airtel, Vi or BSNL), not by BulkSMSPlans. In the list of the OTP template the vendor's own number is `193042`; the DLT ID is the masked `*****4710` column. Order:

1. On the DLT portal, whitelist `https://ocarindia.com` (if it is not already), then add each template under Templates: header `ODCARI`, the text below, the category the portal asks for (not Promotional). DLT portals normally write variables as plain `{#var#}`: if the portal rejects `{#var1#}`, use `{#var#}` in the same order.
2. When the portal approves it, copy the DLT Template ID it shows.
3. Add the template in BulkSMSPlans with that ID (the form asks for it).
4. Send the IDs to the developer.

## Template 1: `trip_share`

Sent when a rider picks a saved contact in "Share live trip". The rider chose to send it.

```
Ocar: {#var1#} is sharing a live ride with you. Track it here: https://ocarindia.com/t/{#var2#}
```

| Variable | Is | Max length |
|---|---|---|
| `{#var1#}` | the rider's first name (cut to 30 characters in code) | 30 |
| `{#var2#}` | the link's token, always 22 characters, letters/digits/`-`/`_` | 30 |

Sample for the form: `Ocar: Asha is sharing a live ride with you. Track it here: https://ocarindia.com/t/kP3xQ9mZ2vL8nR4tY7wB1c`

Fits one SMS (about 132 characters with both variables at their maximum).

## Template 2: `sos_contact_live`

Sent to the rider's emergency contacts when they press SOS on a trip.

```
Ocar SAFETY ALERT: {#var1#} pressed the SOS button during an Ocar ride and may need help. Live location: https://ocarindia.com/t/{#var2#} Please call them now.
```

| Variable | Is | Max length |
|---|---|---|
| `{#var1#}` | the rider's first name (cut to 30 characters in code) | 30 |
| `{#var2#}` | the link's token, 22 characters | 30 |

Sample for the form: `Ocar SAFETY ALERT: Asha pressed the SOS button during an Ocar ride and may need help. Live location: https://ocarindia.com/t/kP3xQ9mZ2vL8nR4tY7wB1c Please call them now.`

Two SMS parts when long (about 200 characters at the maximum, about 168 with a typical name). That is fine for an emergency.

## Before you submit

1. **Whitelist the domain.** Under DLT the URL `https://ocarindia.com` must be whitelisted for the entity; the templates contain it as fixed text and only the token after `/t/` varies. If BulkSMSPlans asks for the full path prefix, give `https://ocarindia.com/t/`.
2. **The domain must be the real one.** The share link is built from `USER_APP_URL` in production, and the registered text hard-codes `https://ocarindia.com`. If production's user-app URL is different (for example `www.` or another domain), say so and I will change both before you submit; the text must match exactly.
3. **Category.** These are not promotional: do not register them as Promotional (blocked at night and for DND numbers, which would block an SOS at 2 am). Ask BulkSMSPlans which of Transactional or Service-implicit they approve for "a rider shares their ride with a contact" and "SOS alert to an emergency contact". The recipient is not an Ocar account holder, which is why an operator may ask questions.
4. **If the vendor will not accept a variable after a fixed path**, the fallback is to register the whole link as one variable. That does not fit a 30-character slot (the link is about 46 characters), so ask them what the link variable limit is, and tell me, because the migration and code would change.

## Also check: the existing SOS wording

The older static-map SOS text (`sos_contact`, migration 104) also needs a DLT template, and the live-link wording falls back to it whenever the live one is unavailable. If it was never registered, register it too:

```
Ocar SAFETY ALERT: {#var#} pressed the SOS button during an Ocar ride and may need help. Last location: https://maps.google.com/?q={#var#},{#var#}. Please call them now.
```

(`maps.google.com` has to be whitelisted for that one.) I cannot see from the repository whether it was registered.

## After approval

1. Send me the template IDs. The login OTP passes its ID to the vendor (`BULKSMSPLANS_OTP_TEMPLATE_ID`); the other templates, including the SOS one, are sent without an ID today. If BulkSMSPlans needs the ID on every send, I will add one setting per template.
2. In admin: Config, Notification Templates, activate `trip_share` and `sos_contact_live`.
3. Send yourself a test: share a trip to your own number from the rider app and check the text arrives with a working link.
4. Turn on `trip_share_enabled` for internal testers, then for everyone.

A test (`api/tests/unit/ride-shares/share-sms.test.ts`) fails if the wording in the migration stops matching the two texts above, so the app cannot drift from what DLT approved.
