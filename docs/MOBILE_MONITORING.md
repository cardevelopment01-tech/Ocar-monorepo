# Mobile monitoring and over-the-air updates

Both Android apps (`apps/driver-mobile`, `apps/rider-mobile`) report crashes, errors, slow or failing API calls and a few
product events. They can also receive JavaScript-only fixes without a Play Store release. All of it ships in one native
release; nothing here reaches users until that build is out.

## What is wired

| Tool | What it gives us | Where |
|---|---|---|
| Crashlytics | Native and JS crashes, device and OS breakdown | `@react-native-firebase/crashlytics`, started in `telemetry/index.ts` |
| Sentry | Errors, React render errors, slow app start and screens (10% of sessions traced) | `Sentry.init` in `telemetry/index.ts`, root wrapped by `wrapRoot` |
| PostHog | Funnels and screen views: `login_success`, `go_online`, `go_offline`, `ride_booked`, `ride_cancelled`, `call_started`, `api_error`, `api_slow` | `track()` calls; `reportApiCall` fires `api_error`/`api_slow` for every REST call |
| expo-updates | OTA JavaScript updates | `runtimeVersion` + `updates` in each `app.json`, `channel` per EAS profile |

All of it goes through `packages/mobile-shared/src/telemetry/`. Each part is **off** when its key is blank and in dev builds, and every
call is wrapped so monitoring can never crash the app.

`api_error` carries route (ids templated to `:id`), method, HTTP status and the server error code. Example: the 62 refused
go-online attempts in the 31 Oct trial would show as `api_error` with `code = DRIVER_DOCS_REJECTED` on
`/api/v1/rides/sessions/online`, with the time and user.

## Privacy rules (do not loosen)

- Users are identified as `driver:<id>` / `rider:<id>` only. Never send phone, name, email, address or coordinates.
- URLs are cut at `?` before leaving the device (`scrubUrl`), because coordinates and search text travel in query strings.
- `sendDefaultPii` is off. **Session replay is deliberately not enabled**: the ride map would be captured. Revisit only with map masking.
- Event props must be ids, codes, counts or booleans.
- Before the build is published: add Crashlytics/Sentry/PostHog data to the privacy policy (`/legal/privacy`) and update the
  Play Console **Data safety** form (crash logs, diagnostics, app interactions, user id; none sold, none shared for ads).

## One-time setup (needs the owner's accounts)

1. **Sentry**: create two projects (Ocar Driver, Ocar Rider, platform React Native). Copy each DSN.
2. **PostHog**: create one project (pick the India-closest region, EU or US). Copy the project API key and host.
3. Put the keys in each app's committed `.env.production` (they are public client keys, not secrets):
   `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`.
4. **Readable Sentry stack traces**: create a Sentry auth token, set `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` in the
   build environment (EAS secrets, or the shell for local builds) and remove `SENTRY_DISABLE_AUTO_UPLOAD` from `eas.json`.
   Until then the build works but JS stack traces in Sentry are minified.
5. **OTA**: in each app folder run `eas login` then `eas update:configure`. It writes `updates.url` and `extra.eas.projectId`
   into `app.json`. Until this is done the apps ignore OTA.
6. Turn on 2-step verification for the Expo account. Anyone who can publish an update can change the code on every phone.
7. Bump `android.versionCode` in both `app.json` files, build the release, and upload to Play (internal testing first).

## Shipping a JS-only fix after that

```
cd apps/driver-mobile   # or rider-mobile
eas update --channel production --message "fix: ..."
```

- Phones fetch it in the background and apply it on the next cold start.
- `runtimeVersion` uses the `fingerprint` policy: it changes whenever native code or native dependencies change, so a phone
  only receives updates built for its own native code. If you add a native package, you must ship a new store build.
- Roll back with `eas update:rollback` (or republish the previous update to the channel).
- Test on the `preview` channel before `production`.

## Known limits

- Crashlytics and Sentry both capture native crashes. If a crash ever shows once in one tool and not the other, that is the
  two crash handlers chaining; Sentry is the one with readable JS traces.
- Crashlytics JS stack traces are minified; use Sentry for JS.
- The 31 Oct trial happened before any of this existed, so those crashes cannot be recovered. Use Play Console Android vitals for that day.
