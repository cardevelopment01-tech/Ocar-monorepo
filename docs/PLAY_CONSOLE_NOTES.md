# Play Console notes: what to enter and do

Companion to `docs/PLAY_STORE_READINESS_2026-10-13.md`. Everything here is Console or machine work that code cannot do for you. Text in quotes is ready to paste; adjust names and numbers to match reality before submitting.

---

## 1. Create the upload keystore (once, you own it)

Do this on your own machine, not in the repo. **Back up the file and both passwords somewhere safe (password manager plus an offline copy).** Play App Signing holds the real app-signing key; this is only the *upload* key, but losing it means asking Play support to reset it.

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore C:\keys\ocar-upload.jks -alias ocar-upload -keyalg RSA -keysize 2048 -validity 10000
```

Answer the name/organisation questions and choose a strong password (reuse it for the key password when asked).

Then put the credentials in your user Gradle properties file, `C:\Users\<you>\.gradle\gradle.properties` (not in the repo):

```properties
OCAR_UPLOAD_STORE_FILE=C:/keys/ocar-upload.jks
OCAR_UPLOAD_STORE_PASSWORD=<store password>
OCAR_UPLOAD_KEY_ALIAS=ocar-upload
OCAR_UPLOAD_KEY_PASSWORD=<key password>
```

Release builds (`./gradlew bundleRelease`) then sign with it. Without these properties, release builds fall back to the debug key (fine for emulator testing, rejected by Play). Build the bundle from a short path (see your emulator notes about Windows long paths) and with at least 3 GB of Gradle heap for R8.

In Play Console, create the app and let **Play App Signing** manage the app-signing key when you upload the first bundle. Register the upload certificate's SHA-1 in the Google Cloud Maps key restriction (alongside the Play App Signing SHA-1 shown under Setup > App signing).

Check the bundle before uploading:

```powershell
bundletool dump config --bundle=app-release.aab | findstr alignment   # expect PAGE_ALIGNMENT_16K
```

Upload the R8 `mapping.txt` and native debug symbols with each release.

---

## 2. Background location declaration (driver app only)

Console path: App content > Sensitive app permissions > Location permissions. Declare **one** feature only.

- **Main purpose of the app:** "Ocar Driver lets licensed taxi drivers in Odisha receive and complete intercity ride requests."
- **Feature that needs background location:** "Receiving ride requests and tracking the active trip while the driver is online."
- **Why it cannot work without it:** "A driver who is online keeps the phone in a pocket or switches to a navigation app. Ride requests are matched to the nearest available driver using the driver's current location, and the rider and Ocar's control room track the trip live for safety. If location stopped when the screen turned off or the app was minimised, the driver would stop receiving requests and the rider could not see their cab, which is a safety problem."
- **Video (30 seconds or less, from a real device, upload to YouTube unlisted):** open the app, tap Go Online, show the "Location while you drive" disclosure (which says location is collected even when the app is closed or not in use), tap the button, show the Android permission prompt and grant "Allow all the time", then press Home and show the persistent "Ocar is tracking your location" notification.
- **Also:** the same sentence must appear in the store description, for example: "Ocar Driver collects your location in the background, even when the app is closed or not in use, while you are online, so you can receive ride requests and your trips can be tracked for safety."

## 3. Foreground service declarations (driver app)

Console path: App content > Foreground service permissions. After the media-playback fix, declare two types.

**Location**
- Use case: Navigation / ride tracking for ride share.
- Description: "While a driver is online or on a trip, a foreground service with a visible notification keeps reporting the vehicle's location so ride requests can be matched and the trip tracked."
- User impact if interrupted: "Requests stop arriving and the rider cannot see the cab."
- Video: the same recording as section 2, showing the notification.

**Data sync** (this comes from the PayU payments SDK's transaction-status service, not Ocar code)
- Description: "When a driver tops up their wallet, the payment SDK checks the transaction status in a foreground service so a completed payment is not lost if the app is minimised."
- User impact if interrupted: "A payment could be taken without the wallet being credited until the next status check."
- The app declares `FOREGROUND_SERVICE_DATA_SYNC` (driver `app.json`) so this service can run on Android 14 and later; without it the system throws a security error when PayU starts the service.
- Video: with the test PayU keys and `mobile_payments_enabled` on, start a wallet top-up, press Home mid-payment, and show the status-check notification. If you cannot get a notification to appear, tell me and I will add a manifest rule to remove the service instead (then drop this declaration).

The rider app declares no foreground services of its own **(verify in its merged manifest once a release build exists)**.

---

## 4. App access (reviewer login)

Console path: App content > App access > "All or some functionality is restricted".

1. Set `REVIEW_PHONE` and `REVIEW_OTP` in the production environment (see PR #185), for example `+919999900001` and a 6-digit code. Use a number that is not a real person's.
2. Rider app: open it, enter that phone, enter the code. The rider account is created.
3. Driver app: same phone and code. Complete onboarding with placeholder details and sample document images, then approve this driver in the admin portal so the reviewer can reach Home and go online.
4. In the Console, add two entries ("Ocar Rider" and "Ocar Driver") giving the phone number and code, and the note: "Enter the phone number, tap Continue, enter the 6-digit code. No SMS is sent for this test account."
5. After the review is approved, clear `REVIEW_PHONE` and `REVIEW_OTP` and redeploy. Set them again for each new review.

---

## 5. Account deletion

Console path: App content > Data safety (the deletion questions).

- Does the app let users create an account? Yes. Can they request deletion in the app? Yes (Profile > Delete account, in both apps).
- **Deletion URL:** `https://ocarindia.com/legal/delete-account`
- Retention to disclose: ride and payment records kept as financial law requires, without name or phone; driver verification documents kept for the regulatory period; deletion requested by email is acknowledged within 48 hours and completed within 15 days.

---

## 6. Data safety form: what to declare

Collected, all encrypted in transit (HTTPS/TLS), all user-provided or collected for app functionality unless noted:

| Data type | Rider app | Driver app | Purpose | Shared with |
|---|---|---|---|---|
| Phone number | Yes | Yes | Account, authentication | None (SMS vendor processes it on our behalf) |
| Name, email (optional) | Yes | Yes | Account, support | None |
| Date of birth, address, gender | No | Yes | Driver onboarding and verification | None |
| Government ID numbers (Aadhaar, driving licence) | No | Yes | Driver verification | None |
| Photos (selfie, ID and vehicle documents) | No | Yes | Verification | None |
| Precise location (foreground) | Yes | Yes | Pickup, matching, trip tracking | Google (Maps) |
| Precise location (background) | No | Yes | Ride requests and trip tracking | Google (Navigation) |
| Messages (in-ride chat) | Yes | Yes | App functionality | None |
| Payment info (ride and wallet payments) | Yes (via gateway) | Yes (via gateway) | Payments | PayU (payment processor) |
| Bank account / UPI | No | Yes | Driver payouts | Payout provider |
| Device or other IDs (push token) | Yes | Yes | Notifications | Google (Firebase Cloud Messaging) |

Not collected or shared for advertising, analytics or personalisation. No ads. Data can be deleted on request (section 5).

Declarations for the SDKs (Google Maps and Navigation, Firebase Messaging, PayU) must match what each actually collects; Google can act on a mismatch. Re-check this table against the final release build.

---

## 7. Submission checklist

- [ ] Upload keystore created, backed up, properties set; release bundle signed with it
- [ ] Bundle alignment check shows `PAGE_ALIGNMENT_16K`; mapping file and symbols uploaded
- [ ] Deploy API (migrations 111 to 114) before the apps; confirm `/legal/delete-account` is live
- [ ] Reviewer login set up (section 4) and tested from a clean install
- [ ] Background location form and video (driver); foreground service declarations
- [ ] Data safety form, content rating, target audience, ads = none, privacy policy URL
- [ ] Store listing text, icon, feature graphic, screenshots, support email
- [ ] If the developer account is personal and newer than 13 Nov 2023: closed test with 12 testers for 14 days
- [ ] Google Maps key restricted to the package names and both signing SHA-1s
