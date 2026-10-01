# Rider app Maestro flows (location states)

Install Maestro (https://maestro.mobile.dev), start an Android emulator or device with a **debug or preview
build of `com.ocar.rider`**, sign in once by hand (login is an OTP, so flows cannot do it), then:

    maestro test apps/rider-mobile/.maestro

`setLocation` needs an emulator (or a device with mock locations allowed).

## Scripted here (5)
| File | Covers |
|---|---|
| 01-permission-denied | denied: "Location off · Set pickup location" is tappable and opens the picker |
| 02-live-fix-cold-start | granted + GPS fix: pill resolves, no exit/searching message |
| 03-saved-fix-instant | relaunch: pill has a value within 3 s from the saved fix |
| 04-booking-pickup-from-fresh-fix | booking pickup fills from a fresh fix only |
| 05-booking-denied-label | booking label matches the home pill wording |

Status: written against the current UI strings; **not yet run** (no emulator was available when they were written).
Expect to adjust selectors on first run.

## Not scriptable with Maestro, run by hand on a release APK
These need time travel, storage faults, network inspection or another login, which Maestro cannot drive:
1. Saved fix older than 30 min: dim dot, no pulse, no blue dot, pill "Finding your location…" (set the emulator clock forward, kill and relaunch).
2. No fresh fix after 8 s: pill becomes "Set pickup location" and the booking label flips with it (`adb shell cmd location set-location-enabled false`, then relaunch).
3. Slow/corrupt storage: splash proceeds after 1 s (clear app data mid-launch, or throttle with `adb shell`).
4. Geocode failure: turn network off after the GPS fix; pill shows "Current location", never the old street.
5. Warm resume after 30 min elsewhere: foreground refreshes the fix and pill (change the mock location, background 30 min or move the clock).
6. Pan the map while on a saved fix, then let the fresh fix arrive: camera and pickup do not move.
7. SOS mid-ride: the POST /api/v1/safety/sos body carries live lat/lng (proxy or `adb logcat` on the API).
8. Ride edit-pickup sheet: no rider marker/distance until the first live fix.
9. Sign out, sign back in, relaunch: no saved location or street from the previous account; also after a forced logout.
10. Screen reader (TalkBack): each pill state is announced once; tappable states are buttons with a 44 dp target; reduce-motion stops the pulse.
