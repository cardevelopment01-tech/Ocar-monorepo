# Frontend Performance & Code-Bloat Audit (apps/user & apps/driver)

**Scope:** apps/user (Next.js 16 passenger app) and apps/driver (Vite + React 19 driver app). Read-only audit; no source changes. Known placeholders from CLAUDE.md (mock earnings, hardcoded saved places, DEMO_MODE blocks) are not flagged as bugs.

**Overall health:** Both apps are in better shape than typical AI-heavy codebases. Socket listeners and intervals are consistently cleaned up, route refetches are properly guarded (deviation/staleness checks in three places), heavy map scenes are dynamically imported, and `CarMarker` is correctly memoized with a custom comparator. The real problems are concentrated: two hot paths re-render enormous page components at 60fps / 1Hz (user ride tracking, driver trip screen), the driver app ships every page in one bundle, and there is heavy copy-paste duplication (6+ haversine implementations, twin OTP cards, twin active-ride screens, twin axios interceptors across apps).

---

## User App: Performance Bottlenecks

### 1. HIGH: Ride tracking page re-renders its entire 894-line tree at ~60fps while the driver moves

`apps/user/app/(main)/ride/[id]/page.tsx:127` + `apps/user/lib/useInterpolatedPosition.ts:94`

```ts
// ride/[id]/page.tsx — hook lives at the top of the page component
const { pos: smoothPos, heading: smoothHeading } = useInterpolatedPosition(driverPos, 0)
```
```ts
// useInterpolatedPosition.ts — inside the rAF tick
setPos([lat, lng])
setHeading(hdg)
if (t < 1) rafRef.current = requestAnimationFrame(tick)
```

The interpolation hook calls `setPos`/`setHeading` on **every animation frame** for the full 3s window after each socket fix, and that is continuous during an active ride. Because the hook sits in `RidePage` itself, every frame reconciles the whole page: the bottom sheet, both `AnimatePresence` trees, the OTP cards, framer-motion status badge, everything. On a mid-range phone this is a sustained 60Hz reconciliation of a very large tree for the entire trip, the single hottest path in the app.

**Fix:** move the interpolation below the map boundary so only the marker subtree animates:

```tsx
// RideMapScene.tsx (already dynamically imported)
function SmoothCarMarker({ rawPos, rawHeading }: { rawPos?: [number, number]; rawHeading: number }) {
  const { pos, heading } = useInterpolatedPosition(rawPos, rawHeading)
  return pos ? <CarMarker position={pos} heading={heading} /> : null
}
// RidePage passes raw driverPos; wrap RideMapScene in React.memo so the
// 60fps churn never leaves the marker component.
```
Also derive `mapCenter` inside the map scene (it currently uses `smoothPos`, which is what forces the hook to live at page level).

### 2. HIGH: Breadcrumb trail grows unbounded and is copied + re-rendered on every driver location tick

`apps/user/app/(main)/ride/[id]/page.tsx:219-225`

```ts
const onDriverLocation = (data) => {
  setDriverPos([data.lat, data.lng])
  if (rideStatusRef.current === 'in_progress') {
    const next: [number, number][] = [...breadcrumbRef.current, [data.lat, data.lng]]
    breadcrumbRef.current = next
    setBreadcrumb(next)
  }
}
```

Every location event (every ~3s for the whole trip) spreads the entire accumulated array, which is O(n²) over the ride. A 2-hour trip at one fix/3s is ~2,400 points: each tick allocates a 2,400-element array, triggers a page re-render (compounding finding #1), and `BreadcrumbTrail`'s `useMemo` re-maps all points into `{lat,lng}` objects before Google Maps redraws the full polyline.

**Fix:** decimate and cap: only append when the driver moved a meaningful distance, and keep the state small:

```ts
const last = breadcrumbRef.current.at(-1)
if (!last || haversineMetres(last, [data.lat, data.lng]) > 25) {
  breadcrumbRef.current.push([data.lat, data.lng])          // mutate the ref
  setBreadcrumb(breadcrumbRef.current.slice(-500))          // bounded copy, new identity
}
```

### 3. MEDIUM: Fare-estimate loading waterfalls two independent requests per category

`apps/user/app/(main)/select-ride/page.tsx:121-150`

```ts
await Promise.allSettled(categories.map(async cat => {
  results[cat.id] = await rideApi.getEstimate({ ... })      // ← awaited first
  if (rideType === 'one_way') {
    const rc = await rideApi.getReturnCabAvailable({ ... }) // ← independent, waits anyway
    ...
```

Categories run in parallel (good), but inside each category the standard estimate and the return-cab availability check are sequential despite being independent, doubling perceived latency on the screen the user stares at right before booking. It's up to 12 HTTP calls for one screen; a batched estimate endpoint would be the real fix, but client-side:

```ts
const [est, rc] = await Promise.all([
  rideApi.getEstimate({...}).catch(() => null),
  rideType === 'one_way' ? rideApi.getReturnCabAvailable({...}).catch(() => null) : null,
])
```
Note `loadEstimates` also re-fires all 12 requests whenever `tripHours` changes (each hour-chip tap); the return-cab half doesn't depend on `tripHours` and could be skipped.

### 4. MEDIUM: Home hero runs 11 infinite framer-motion animations over large blur filters

`apps/user/app/(main)/home/page.tsx:205-256`: three orbs animating `x/y` under `filter: blur(32–48px)` plus 8 twinkling particles animating `opacity`+`scale`, all `repeat: Infinity`, running the entire time Home is visible. Big blurred layers are expensive to composite on low-end Android GPUs and this drains battery on the app's most-visited screen. `useReducedMotion` is respected (good), but that only helps users who opted out.

**Fix:** collapse the orbs into one static blurred background image (or CSS `@keyframes` on `transform` only with `will-change: transform`), and drop the particles to CSS animations, since framer-motion runs these through JS springs per frame.

### 5. LOW: `pickupPos`/`dropPos` memos keyed on the whole `ride` object

`apps/user/app/(main)/ride/[id]/page.tsx:276-283`: `useMemo(..., [ride])` recomputes and returns a **new array identity** after every `setRide` (each socket status update, driver-assigned patch, fare drift), which then invalidates the route-fetch effect at line 325 whose deps include `pickupPos`/`dropPos`. The staleness guards prevent extra network calls, but the effect body reruns needlessly. Key the memos on primitives: `[ride?.origin_lat, ride?.origin_lng]`.

### 6. LOW: History tabs filter a server-paginated page client-side

`apps/user/app/(main)/history/page.tsx:376`: `rides.filter(r => r.status === tab)` runs over only the current 20-item page, so the "Completed" tab can show 3 items while page 2 has 17 more (pagination counts don't match the filter). Cheap CPU-wise; the issue is an extra full page fetched for data mostly thrown away. Pass `status` to `getHistory` instead.

### 7. LOW: Dead heavy dependencies in package.json

`apps/user/package.json:20,24` and `apps/driver/package.json:18,21` declare `maplibre-gl` (~750KB min) and `react-map-gl` but **zero imports exist in either app** (both use `@vis.gl/react-google-maps`). Not in the shipped bundle today, but it inflates installs and is one accidental import away from +200KB gz. Remove both from both apps.

---

## User App: Code Bloat / AI-Slop Cleanup

| # | File / lines | Current size | Issue | After |
|---|---|---|---|---|
| 1 | `ride/[id]/page.tsx:720-829` | ~110 lines | Start-OTP and End-OTP cards are byte-identical JSX except color tokens, the OTP value, and the copied-state pair | One `<OtpCard otp label colors onCopy>` (~35 lines), used twice (**−75 lines**) |
| 2 | `ride/[id]/page.tsx:434-478` + `629-678` | ~95 lines | "Route preview row" (pickup/drop dots + rental/round-trip variants) duplicated between the searching view and the driver-assigned view | One `<RouteSummary ride fare?>` (**−55 lines**) |
| 3 | `ride/[id]/page.tsx:386-397` | 12 lines | Two parallel ternary chains mapping status → background / border colors, duplicating `STATUS_CONFIG` which already exists 340 lines up | Add `bg`/`border` fields to `STATUS_CONFIG` and read `cfg.bg` |
| 4 | `history/page.tsx:69-230` | ~160 lines | `RideCard`, `UpcomingCard`, `ActiveRideCard` are three near-clones (badge row + dot-rail route + footer) | One `<TripCard badge fare date footer>` with slots (**−90 lines**) |
| 5 | `select-ride/page.tsx:512-547` | 36 lines | `estimates[selected]!.breakdown` repeated 8×; fare breakdown rows are 5 copies of the same 4-line flex row | `const b = estimates[selected]!.breakdown` + a `rows` array `.map()` (**−20 lines**) |
| 6 | `select-ride/page.tsx:349-509` | ~160 lines | Return-cab row and standard category row are ~80-line JSX twins (icon tile, name, fare, radio) differing only in accent color and sub-line | One `<CategoryRow>` with a `tone: 'violet' \| 'emerald'` prop (**−70 lines**) |
| 7 | 4 copies of haversine | `ride/[id]/page.tsx:33`, `select-ride/page.tsx:27`, `confirm-pickup/page.tsx:21`, `useInterpolatedPosition.ts:22` | Same formula reimplemented per file (one deliberately equirectangular; keep that one separate or parameterize) | Single `lib/geo.ts` export |

Notably **not** flagged: `search/page.tsx` (830 lines but the state machine is genuinely intricate and mostly non-repetitive), `lib/api.ts` interceptors (necessary complexity), `Documents`-style data-driven config.

---

## Driver App: Performance Bottlenecks

### 1. HIGH: No route-level code splitting: all 20 pages ship in the entry bundle

`apps/driver/src/App.tsx:7-25`: every page (`Login`, 6 onboarding pages totalling ~2,400 lines incl. `Documents` 575, `ReferenceSelfie` 499, `PersonalDetails` 485, plus `DatePickerSheet` 356), all GoOnline and ActiveRide screens, `Earnings`, `Wallet`, are all imported eagerly. Map *components* are `lazy()` (good), but a driver opening the app to go online downloads the entire onboarding flow, date pickers, and selfie-capture code first. framer-motion is imported in 19 files so it's unavoidable in the core, but page code isn't.

**Fix:**

```tsx
const Documents = lazy(() => import('@/pages/Onboarding/Documents'))
// ...same for all /onboarding/*, Earnings, Wallet, TripEnd
<Route path="/onboarding/documents" element={
  <ProtectedRoute><Suspense fallback={<PageSpinner/>}><Documents/></Suspense></ProtectedRoute>
} />
```
Onboarding is visited once per driver lifetime, making it the textbook split point.

### 2. HIGH: `useElapsed` re-renders the entire TripInProgress map screen every second, for the whole trip

`apps/driver/src/pages/ActiveRide/TripInProgress.tsx:52-67`

```ts
function useElapsed(startedAt?: string) {
  const [seconds, setSeconds] = useState(initial)
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    ...
}
export default function TripInProgress() {
  const elapsed = useElapsed(activeRide?.rideStartedAt)   // ← ticks page-level state
```

The 1Hz tick lives in the page component, so the full screen (lazy map subtree `DriverMapView` + `RecenterMap` + `RoutePolyline` + markers, both bottom sheets, `AnimatePresence`) reconciles every second for the entire ride, on top of the GPS-fix re-renders already happening. This runs for hours on a device that's also doing GPS + navigation.

**Fix:** make the clock a leaf:

```tsx
function ElapsedClock({ startedAt }: { startedAt?: string }) {
  const elapsed = useElapsed(startedAt)
  return <span className="font-mono tabular-nums text-sm font-semibold">{elapsed}</span>
}
```
`handleCompleteTrip` reads elapsed by parsing the display string (`elapsed.split(':')`); compute duration from `startedAt` directly instead (`(Date.now() - Date.parse(startedAt)) / 60000`), which also removes the page's dependency on the ticking value entirely.

### 3. MEDIUM: Zustand stores consumed without selectors, causing broad re-renders, including at the App root

`apps/driver/src/App.tsx:39-41`, `Home.tsx:35`, `NavigateToPickup.tsx:33-34`, `TripInProgress.tsx:66-68`

```ts
const { isOnline, setOnline, setOffline } = useSessionStore()          // whole-store subscribe
const { incomingRequest, setIncomingRequest, ..., activeRide } = useRideStore()
```

Calling the hook with no selector subscribes to the **entire store**. `App` re-renders on *every* write to `useRideStore` (each OTP set (`setStartOtp`, `setEndOtp`), every `updateRideStatus`, every incoming-request set/clear), and an App re-render reconciles `<Routes>` and whichever page is mounted. The active-ride pages likewise re-render when unrelated slices change. Stores are small so each individual write is cheap, but during a ride these writes coincide with the 1Hz/GPS churn above.

**Fix:** narrow every consumer:

```ts
const isOnline = useSessionStore(s => s.isOnline)
const incomingRequest = useRideStore(s => s.incomingRequest)
// actions are stable: const setOnline = useSessionStore(s => s.setOnline)
```

### 4. MEDIUM: Home re-renders its full sheet on every GPS fix

`apps/driver/src/pages/Home.tsx:129-131`: `useDriverLocation` sets position on each device fix (1–5s), and `setMapCenter(gpsPosition)` re-renders all of Home (stats grid with three `motion.div`s, quick actions, banners) even though only the map center and `SelfCarMarker` care. The sheet drag itself is exemplary (motion values + RAF-throttled occlusion), which makes the GPS-driven full-page churn the remaining cost. Move `mapCenter`/marker into a small child component that owns `useDriverLocation`, and lift only `gpsError`/`positionReady` up (or store position in a motion-value/ref for the map).

### 5. LOW: TripRequestCard per-second interval

`apps/driver/src/components/ui/TripRequestCard.tsx:56-69`: the countdown re-renders the full-screen overlay each second. Acceptable (≤30s lifetime, correctly cleaned up); only worth touching if the accept modal ever feels janky.

**Deliberately not flagged (done right):** route refetch deviation/staleness guards in both ActiveRide screens and the user ride page; `watchPosition` restart on visibility change; socket cleanup discipline; `onSync` throttling in `useDriverLocation`; RAF-throttled sheet occlusion in Home.

---

## Driver App: Code Bloat / AI-Slop Cleanup

| # | File / lines | Current size | Issue | After |
|---|---|---|---|---|
| 1 | `NavigateToPickup.tsx` + `TripInProgress.tsx` | 344 + 328 lines | Twin screens duplicating: `haversineMetres` (lines 22-29 / 43-50), the wake-lock effect (57-70 / 99-112), the guarded route-fetch effect (86-100 / 117-133), the RENTAL/RETURN badge + context-banner JSX (166-204 / 200-245), and the SOS handler | Extract `useWakeLock()` (~12 lines), `useRouteTo(position, dest)` (~25 lines), `<RideTypeBanners ride>` (~25 lines) → **−120 lines total**, and future fixes land once |
| 2 | `App.tsx:74-93` + `201-215` | ~40 lines | Session-restore and `handleAcceptRide` both hand-build `activeRideInput` with eight identical `if (x != null) input.field = x` lines (the `exactOptionalPropertyTypes` pattern, but copy-pasted) | One `toActiveRide(ride: RideDetail, fallback?): ActiveRide` mapper in `lib/ride-api.ts` → **−25 lines** |
| 3 | `App.tsx:121-130` + `TripInProgress.tsx:150-158` | 2×9 lines | Same inline haversine-with-1.3-road-factor formula duplicated (and a third plain copy at `TripInProgress.tsx:43`) | `estimateRoadKm(a, b)` in a shared `lib/geo.ts` |
| 4 | Cross-app duplication | ~400 lines | `api.ts` interceptors (user 125 / driver 121 lines, ~90% identical), `socket.ts`, `RecenterMap`, `RoutePolyline`, `LocationPin`, `SplashScreen` (175/173), `OcarLogoMark` (100/98), `fmtReturn` vs `formatReturnAt`, all maintained twice | CLAUDE.md notes packages/ has no shared runtime code yet; a `packages/shared` for geo utils, date formatting, and the axios-refresh interceptor factory is the structural fix. Until then, at minimum keep the pairs consciously in sync |

**Deliberately not flagged:** `Documents.tsx` (575 lines): it looks big but is properly data-driven (`DocGroupDef[]` config + three small components); shrinking it further would hurt clarity. `Home.tsx`'s sheet-drag machinery is verbose but every line is doing real gesture work.

---

## Priority Action List

Ranked by impact × ease of fix:

1. **Extract `ElapsedClock` leaf in TripInProgress** (`apps/driver/src/pages/ActiveRide/TripInProgress.tsx:52`): kills a 1Hz full-map-screen re-render for entire trips; ~15-minute change.
2. **Move `useInterpolatedPosition` below the map boundary** (`apps/user/app/(main)/ride/[id]/page.tsx:127`): stops 60fps reconciliation of the 894-line ride page, the app's hottest path.
3. **Decimate + cap the breadcrumb array** (`apps/user/app/(main)/ride/[id]/page.tsx:219`): removes O(n²) growth on every location tick.
4. **`React.lazy` the driver onboarding/earnings/wallet routes** (`apps/driver/src/App.tsx:7-25`): biggest first-load win in the driver app; mechanical change.
5. **Narrow all Zustand subscriptions to selectors** (`apps/driver/src/App.tsx:39-41` et al.): stops App-root re-renders on every ride-store write; find-and-replace scale.
6. **Parallelize estimate + return-cab check in `loadEstimates`** (`apps/user/app/(main)/select-ride/page.tsx:121`): halves latency on the booking decision screen.
7. **Extract shared `useWakeLock` / `useRouteTo` / `RideTypeBanners` from the twin ActiveRide screens**: ~120 duplicated lines gone, future fixes land once.
8. **Remove dead `maplibre-gl` + `react-map-gl` deps from both apps and dedupe the OTP card / history cards**: low effort cleanup batch (`package.json`, `ride/[id]/page.tsx:720-829`, `history/page.tsx:69-230`).
