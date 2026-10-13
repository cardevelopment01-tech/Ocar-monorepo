# Google Play readiness: rider and driver apps

Date: 2026-10-13. Scope: `apps/rider-mobile` (`com.ocar.rider`) and `apps/driver-mobile` (`com.ocar.driver`) at `main` after PR #182.

**Verdict: neither app is ready to submit yet.** The technical base is good (target SDK, 16 KB alignment, AAB, runtime permissions). What blocks a submission is mostly policy and Console work: no account deletion, debug signing, no reviewer login, a few permissions that should not be there, and the background-location paperwork for the driver app.

How this was checked: Google's own policy pages (fetched, listed in Sources), the built driver release APK (`aapt`, `zipalign`, `llvm-objdump`, merged-manifest report), a throwaway prebuild of the rider app, and a code search of both apps and the API. Anything not directly verified is marked **(unverified)**.

---

## 1. Must fix before the first submission

| # | Issue | Evidence | Policy | Fix |
|---|---|---|---|---|
| B1 | **No account deletion in either app.** Both apps create accounts (rider auto-creates at first OTP login; driver registers). There is no in-app deletion and no web deletion page. | Code search: no delete-account flow in `driver-mobile`, `rider-mobile` or the API user/driver modules. | [Account deletion requirement](https://support.google.com/googleplay/android-developer/answer/13327111): apps that allow account creation must offer deletion in the app **and** a web link (entered in the Data safety form). Retention for legal reasons is allowed if disclosed. | API endpoints to delete or anonymise a rider/driver (keep ride and payment records the law requires, as the privacy policy already says); a "Delete account" row in each app's Profile; a public web page with a request form; add the URL to the Data safety form. |
| B2 | **Release builds are signed with the debug key.** | Generated `android/app/build.gradle`: `signingConfig signingConfigs.debug` for release (lines 117 and 122). | Play rejects debug-signed bundles; the upload key must be your own. | Create the upload keystore (or let EAS manage it), keep a backup, enrol in Play App Signing. A lost upload key means a Play support reset. |
| B3 | **No way for reviewers to log in.** Login is SMS OTP to a real phone; production refuses the dev bypass. | `api/src/config/index.ts`: OTP bypass exists only when no SMS provider is configured, and production refuses to boot that way. | Play Console "App access": if login is required you must give reviewers working credentials. | Add a reviewer account: one fixed phone number with a fixed OTP, enabled by an env flag, bound to a seeded test user/driver with no real data. Document it in App access. Decision needed on the security trade-off (see section 5). |
| B4 | **Permissions the apps do not need.** `SYSTEM_ALERT_WINDOW` (both apps) and `RECORD_AUDIO` (driver). Driver also gets `FOREGROUND_SERVICE_MEDIA_PLAYBACK` plus an audio-controls foreground service. | Merged manifest report: they come from the app's own generated manifest (Expo defaults and `expo-audio`'s default options: `recordAudioAndroid` and `enableBackgroundPlayback` both default to true). `RECORD_AUDIO` was blocked on `expo-camera` but not `expo-audio`. | [Foreground service declaration](https://support.google.com/googleplay/android-developer/answer/13392821) and Data safety accuracy: every declared type needs a description and video; a microphone permission with no feature mismatches the Data safety form. | Add `android.blockedPermissions` for `SYSTEM_ALERT_WINDOW` and `RECORD_AUDIO` in both apps. In the driver `expo-audio` plugin set `recordAudioAndroid: false` and `enableBackgroundPlayback: false`. Trade-off: the ride-request alert sound will not keep playing from a suspended app; the push notification's channel sound still plays. |
| B5 | **Background location paperwork (driver).** | The app has a prominent disclosure (`LocationDisclosure`) shown before the system prompts, which is good. Its text says "Ocar uses your location in the background to send you ride requests and track your trips." | [Location in the background](https://support.google.com/googleplay/android-developer/answer/9799150): needs the Permissions Declaration Form (one feature only), a demo video of 30 seconds or less showing the disclosure and the permission prompt, and disclosure wording that includes the word "location" and says it is used when the app is closed or not in use; the disclosure must also appear in the store description. | Change the disclosure to say "...even when the app is closed or not in use"; write the one-feature justification (receiving ride requests and tracking an active trip while the driver is online); record the video; add the sentence to the listing. Note Google says convenience or foreground-capable features are weak grounds; ride-share driver tracking is the kind of use it expects, but approval is Google's call. |
| B6 | **Foreground service declarations.** The built driver app declares three foreground service types. | Merged manifest: `location` (expo-location tracking, Navigation SDK), `dataSync` (PayU's `CheckTxnStatusForegroundService`), `mediaPlayback` (expo-audio; goes away with B4). | Each type needs a description, user-impact statement and video in App content. Ride tracking is an accepted `location` use case. | Declare `location` and `dataSync` (or remove the PayU service with a manifest merge rule if the payment status check does not need it). Check the rider build separately (rider has no foreground service from its own libraries, **unverified** for the final merged manifest). |

### Fix status (updated after the fixes)

| Item | Status |
|---|---|
| B1 account deletion | Built: PR #184 (API, both apps, public page `/legal/delete-account`). Open decision: driver documents are kept for the regulatory period, nothing purges them yet. |
| B2 release signing | Build hook merged-ready in PR #183 (`withReleaseSigning`). **You** create the upload keystore: steps in `docs/PLAY_CONSOLE_NOTES.md`. |
| B3 reviewer login | Built, off by default: PR #185. Setup in `docs/PLAY_CONSOLE_NOTES.md`. |
| B4 permissions | PR #183: `SYSTEM_ALERT_WINDOW`, `RECORD_AUDIO` blocked; background playback and its foreground service removed. Verified with `expo prebuild` for both apps. |
| B5 location disclosure | PR #183 (wording). Declaration form and 30-second video are yours: text in `docs/PLAY_CONSOLE_NOTES.md`. |
| B6 foreground services | Media playback removed (PR #183). Declare `location` and `dataSync` in the Console: text in `docs/PLAY_CONSOLE_NOTES.md`. |
| R3 `allowBackup` | PR #183. |
| R1, R2, R4, R5, R6 | Not done: chat report, wallet classification, Maps key restriction, tablet check, Aadhaar storage. |

---

## 2. Console work (not code)

- **Privacy policy URL.** Live at `https://ocarindia.com/legal/privacy` (HTTP 200) and linked from both login screens. Before submitting, confirm it covers: background location (driver), account deletion and how to request it, third parties that receive data (Google Maps and Navigation, Firebase Cloud Messaging, PayU), and Aadhaar handling.
- **Data safety form.** Must match real behaviour, including SDKs. Collected today, from the code and schema: phone number, name, email (optional), date of birth, address, emergency contact, driving licence and Aadhaar numbers, photos (selfie, licence, Aadhaar, vehicle papers), precise location (foreground for riders; foreground and background for drivers), chat messages, device push token, payment records. Shared with: Google (Maps/Navigation), Firebase, PayU. Encryption in transit: yes.
- **Content rating, target audience, ads declaration** (no ads), **government/health/news declarations** (none). Check the financial-features declaration for the driver wallet (see R2).
- **Store listing:** short and long description, 2+ screenshots per form factor, 512 px icon, 1024x500 feature graphic, support email, category.
- **Testing track.** If the developer account is a personal account created after 13 Nov 2023, production stays locked until a closed test has had at least 12 testers opted in for 14 continuous days ([requirement](https://support.google.com/googleplay/android-developer/answer/14151465)). Organisation accounts are not affected. Which account type is it?
- **Upload the R8 mapping file and native debug symbols** with each release so crashes are readable.

---

## 3. Risks and should-fix

| # | Item | Why | Action |
|---|---|---|---|
| R1 | **Chat has no report or block.** Rider and driver exchange free-text messages. | [UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937): one-on-one messaging needs a blocking mechanism and apps with registered users need reporting, plus accepted terms and moderation. A trip-scoped chat is a weaker fit than a social app, but a reviewer can still ask. | Add a "Report" action in chat that files a dispute/safety report to the existing admin queue, and state in the terms what is prohibited. Blocking is a smaller question inside a single trip; document why. |
| R2 | **Driver wallet top-up through PayU.** | [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) exempts payments mainly for physical services such as transportation, so rider fares are fine. The policy has no explicit rule for wallet or stored-value balances, only that in-app virtual currency may be used only within the app. A driver wallet that pays platform commission on rides is arguably settlement of a service fee, not a digital good, but this is **not confirmed by Google**. | Describe the wallet accurately in the listing and Data safety form; if a reviewer objects, ask Play support for a written classification before changing anything. |
| R3 | **`allowBackup="true"`** in both generated manifests. | Auto-backup can copy app data to Google Drive. Tokens are in SecureStore (Keystore-backed, not restored), but persisted app state is not. | Set `android.allowBackup: false` in both `app.json` files. |
| R4 | **Google Maps API key committed and unrestricted** (both `app.json`). | Abuse risk, quota theft; Maps terms. | Restrict to the two package names and the Play App Signing and upload SHA-1s, and to the needed SDKs. |
| R5 | **Large screens on API 36.** Both apps lock portrait. | Apps targeting API 36 have orientation and resizability locks ignored on large screens (tablets, foldables). | Open both apps once on a tablet emulator and fix any broken layout, or accept as-is. |
| R6 | **Aadhaar number stored as a 12-digit column; shown masked.** | Not a Play rule: storing full Aadhaar numbers is restricted by Indian law for most private entities. | Get legal advice; consider storing only the last four digits and the document image. |
| R7 | **16 KB page size** is required for updates from 1 Feb 2027 ([Android docs](https://developer.android.com/guide/practices/page-sizes)). | Already passing (section 4); keep it that way when updating the NDK or SDKs. | Re-run the alignment check on every release bundle. |

---

## 4. Already compliant

- **Target SDK 36, min SDK 24** (APK badging). The August 31, 2026 requirement for new apps and updates is met ([target API page](https://support.google.com/googleplay/android-developer/answer/11926878)).
- **16 KB page size:** `zipalign -c -P 16` verification successful; all 28 x86_64 native libraries in the built APK and 23 distinct arm64 libraries from the Gradle cache have 16 KB-aligned LOAD segments. The final arm64 AAB has not been inspected **(unverified)**.
- **AAB for production** (`eas.json` production profile is `app-bundle`), 64-bit libraries included.
- **Runtime `POST_NOTIFICATIONS`**, now requested through an explanation sheet; notification channels created before the prompt.
- **No restricted permissions:** no SMS, call log, contacts, `READ_MEDIA_*` (images come through the system picker, so the photo-permission policy is not triggered), no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (the app only opens the battery settings screen), no full-screen-intent permission, no `QUERY_ALL_PACKAGES`.
- **Foreground service permission for location** declared with the matching service type.
- **Ride payments** are a physical-transport service, outside Play Billing.
- **Terms and privacy links** on both login screens; policy pages live and covering retention and user rights.
- **Safety features:** SOS in the rider app; daily driver identity verification.
- **No ads and no ad SDKs.**

---

## 5. Decisions needed

1. **Reviewer login (B3).** A fixed test phone and OTP in production is a deliberate hole. Mitigation: one number only, a seeded account with no real data, disabled by default and enabled by an env flag, and rotated after review. Acceptable?
2. **Ride-request sound in the background (B4).** Drop `enableBackgroundPlayback` (cleaner Play review, notification channel still sounds) or keep it and declare the `mediaPlayback` foreground service with a video?
3. **PayU `dataSync` service (B6).** Declare it, or remove it from the manifest if it is not needed?
4. **Account type (section 2):** personal or organisation? Decides whether the 12-tester, 14-day closed test applies.

---

## 6. India: not Play rules, but they decide whether you can operate

From secondary legal summaries, not the notified text, so verify with counsel:

- **Motor Vehicle Aggregator Guidelines 2025:** app-side expectations include live trip sharing, a clear driver photo and identity match, ratings both ways, fare and incentive disclosure in the app and on the website, a published grievance officer, a CERT-In-empanelled cybersecurity certification, DPDP-compliant data handling, and driver verification before onboarding. Your app already has several (ratings, SOS, driver photo, daily identity check); trip sharing with contacts, the grievance officer details and the CERT-In certificate were **not verified** in this audit. State-level aggregator licensing is a separate step.
- **DPDP Rules 2025 (notified 13 Nov 2025):** consent-manager provisions from 13 Nov 2026; notice, consent, security and breach duties and data-principal rights from 13 May 2027. Account deletion (B1) and a plain-language consent notice at sign-up are the first two practical steps.

---

## 7. Fix plan, in order

1. **B4** permissions: `app.json` changes in both apps (small).
2. **B1** account deletion: API, both apps, web page (the largest item).
3. **B5** disclosure wording and **B6** declarations: copy change plus Console text and a screen recording.
4. **B3** reviewer account: small API change behind an env flag, after decision 1.
5. **B2** signing and release build, then run the alignment check on the real arm64 AAB.
6. **R1, R3, R4, R5:** chat report, `allowBackup`, Maps key restriction, tablet check.
7. Console: Data safety, App access, listing assets, closed testing if required, then production.

---

## Sources

Official Google pages (fetched):
- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Account deletion requirement](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Location in the background](https://support.google.com/googleplay/android-developer/answer/9799150)
- [Foreground service requirements](https://support.google.com/googleplay/android-developer/answer/13392821)
- [User Generated Content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Photo and video permissions policy](https://support.google.com/googleplay/android-developer/answer/14115180)
- [New personal account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)
- [16 KB page size support](https://developer.android.com/guide/practices/page-sizes)

Secondary (not authoritative, used for context only):
- [DPDP Rules 2025 overview, Conventus Law](https://conventuslaw.com/featured-content/building-indias-digital-privacy-framework-an-overview-of-the-dpdp-rules-2025/)
- [Motor Vehicle Aggregator Guidelines 2025, SCC Online](https://www.scconline.com/blog/post/2025/07/04/motor-vehicle-aggregators-guidelines-pricing-safety-morth-india-2025/)
- [Motor Vehicle Aggregator Guidelines 2025, MediaNama](https://www.medianama.com/2025/07/223-motor-vehicles-aggregator-guidelines-2025/)

Not confirmed from an official page: whether Google would classify the driver wallet as a digital good; the exact content of the Financial features declaration for a wallet; the final arm64 AAB alignment.
