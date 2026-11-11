# Ocar rider app redesign: implementation brief

Reference pack for restyling `apps/rider-mobile`. The user (Sujal) approved these designs. Treat them as the spec for how things look and feel. They are NOT a spec for how things work: every API call, store, hook, socket event and navigation param already in the app stays exactly as it is.

Live canvas (private, owner only): https://claude.ai/artifact/AQT8tBhX1gwQZKVVmW4Q22

## 0. Ground rules

1. Restyle only. Do not change business logic, request shapes, store shape, route names or params.
2. Pixel values, colors, radii, copy and states come from the `.dc.html` files. Screenshots are an approximate render of the same files (see section 2).
3. Reuse what exists before adding anything: `@ocar/mobile-shared` already has `h`, `card`, `shadow`, `font`, `geo`, `ease` tokens and `Button`, `Card`, `FloatingTabBar`, `SOSButton`, `CancelSheet`, `SlideModal`, `Press`, `Text`, `VehicleIcon`, `Skeleton`. Extend them. Do not fork them.
4. Where the design is silent, copy the approved Home screen (`src/features/home/*`, `src/app/(tabs)/home.tsx`).
5. Where the design shows a feature the backend does not have, build the UI behind an optional prop, mark `TODO(backend)`, and list it in the PR. Never invent endpoints.
6. One screen per commit. Run `pnpm --filter @ocar/rider-mobile typecheck && pnpm --filter @ocar/rider-mobile lint && pnpm --filter @ocar/rider-mobile test` before each commit.

## 1. Screen map

| # | Design file | States in screenshots | Repo files to restyle | Logic that must not change |
|---|---|---|---|---|
| 1 | `Main.dc.html` Plan your trip | default, destination picked | `src/app/booking/index.tsx`, `features/booking/components/PlaceAutocompleteField.tsx`, `PlaceRow.tsx`, `StopsList.tsx` | `useAutocomplete`, `useDebouncedValue`, `useRecentSearchesStore`, booking `store.ts`, map-picker navigation |
| 2 | `TripType.dc.html` Trip type and fare | one way, round trip | `src/app/booking/trip-type.tsx`, `round-trip.tsx`, `rental.tsx` | `recommendPackage`, `resolveSelectedCategory`, fare estimate hooks, what gets written to the booking store |
| 3 | `Vehicles.dc.html`, `VehiclesCoupon.dc.html` Choose a ride | default, offers sheet, coupon applied | `src/app/booking/fare.tsx`, `features/booking/components/CategoryCard.tsx`, `SelectRideMap.tsx`, `RiderSheet.tsx` | `useFareEstimates`, `returnCabEstimates`, category availability, the Book button request |
| 4 | `Driver.dc.html` Driver on the way | collapsed, details expanded, safety sheet | `src/app/ride/[id]/index.tsx` (status: driver assigned), `features/ride-tracking/components/DriverCard.tsx`, `DriverIdentity.tsx`, `StopTimeline.tsx`, `TripDetailsCard.tsx`, `RideActions.tsx`, `AddStopSheet.tsx`, `CancelSheet.tsx`, `EditPickupSheet.tsx`, `StatusBanner.tsx` | `useRideTracking`, socket lifecycle, ride status config, cancel flow, add stop flow, ride OTP display |
| 5 | `Ride.dc.html` On trip with SOS | collapsed, details expanded, SOS sheet | same route as 4, status: in progress; `@ocar/mobile-shared` `SOSButton`, `src/app/safety.tsx`, `features/safety/api.ts` | `triggerSos` (note 429 rate limit handling), safety contacts, live tracking |
| 6 | `Chat.dc.html` Chat | default, quick reply sent | `src/app/ride/[id]/chat.tsx` | message fetch/send, socket events, unread handling |
| 7 | `Complete.dc.html` Trip complete and rating | top, scrolled | `features/trip-summary/TripSummary.tsx`, `RatingSection.tsx`, `tripSummaryModel.ts` | `submitRating`, `fetchRatingTags`, summary model math |
| 8 | `Account.dc.html` Account | top, scrolled, sign out sheet | `src/app/(tabs)/profile.tsx`, `saved-places.tsx`, `notification-settings.tsx`, `safety.tsx`, `features/profile/ScreenHeader.tsx` | profile PATCH merge logic, sign out, delete account, version label |
| 9 | `Rental.dc.html` Rental packages ("City Rides"), `RentalStops.dc.html` Plan your stops (up to 8), `RentalAddStop.dc.html` Add a stop | default, package slider, overage estimate, luxury row open, offers sheet, coupon applied, 8 stops summary, stops editor with 5 and 8 stops, add stop empty and search | `src/app/booking/rental.tsx` (`PackageTierScroller` stays a horizontal scroller but gets snap, peek and auto scroll), `features/booking/components/StopsList.tsx` (becomes a summary row plus the editor screen), `ScheduleSheet.tsx`, `RiderSheet.tsx`, add-stop search screen | `fetchVehicleCategories`, `fetchRentalPackages`, `fetchRoute`, `recommendPackage`, `fetchFareEstimate`, `createBooking`, stops store actions (`removeStop`, `swapStop`), `MAX_STOPS` (raise from 3 to 8 only after checking the API allows it), schedule and rider sheets, one open category at a time |

The bottom tab bar (`features/home/FloatingTabBar.tsx` and the shared one) already matches the design; only touch it if a screenshot differs.

## 2. How to read the `.dc.html` files

- Each file is one 390 x 844 screen. Markup uses inline styles, so every px value, color and radius is literal.
- `{{name}}` is a data hole. `<sc-for list="{{x}}" as="v">` is a list loop. Both are placeholders for real data.
- The `<script type="text/x-dc">` block at the bottom has `renderVals()`: it holds the sample data AND the UI state logic (selected vehicle, expanded sheet, applied coupon, star rating). Port that state logic to `useState`; replace the sample data with real data.
- `onClick="{{...}}"` handlers show what is tappable; wire them to the existing handlers.
- `<a href="X.dc.html">` shows the navigation edge between screens; use the existing router calls.
- Animations: `.press:active` is scale .96 to .985 on press; `.fold` max-height reveal and `.chev` rotate are sheet/expand transitions (use the `ease` tokens from `@ocar/mobile-shared`); `.pulse` and `.sos-ring` are looping rings on the map pin and SOS button.
- Screenshots in `screenshots/` were rendered with a small stand-in runtime that fills the holes with default state. They are good for layout and color, but the `.dc.html` is the authority.
- Vehicle images: `assets/vehicle-*.png` are the OLD colored icons used as placeholders. The new white and teal set will replace them; keep using `VehicleIcon`.

## 3. Tokens

Source of truth in code: `packages/mobile-shared/src/theme` (`h`, `card`, `shadow`, `font`). Add only what is missing.

Colors
| Design value | Token / action |
|---|---|
| canvas `#F6FBFB` | `h.canvas` |
| surface `#FFFFFF` | `h.surface` |
| chip `#F7F6F1` (also `#F4F5F1` for icon chips) | `h.chip` |
| ink `#14171A` | `h.ivory` |
| muted text `#5F6468`, label `#6B7176`, faint `#8A9094` | add `h.muted`, `h.label`, `h.faint` (or use `h.ivoryDim` where alpha matches) |
| teal `#0E8FA3` | `h.teal` (map pin, rings, decorative) |
| teal CTA fill `#0B8296` (white text, 4.5:1) | add `h.tealCta`. Use for every primary button |
| teal text on light `#0A7788` | add `h.tealText` |
| teal soft bg `#E8F4F6`, `#E3F3F6` | add `h.tealWash` |
| gold `#D6A552`, light `#E7C27D`, gradient `#F6DC9A` to `#D6A552`, ink on gold `#3E2A05`, gold wash `rgba(214,165,82,0.18)` | `h.gold`, `h.goldLight`; add `h.goldWash`, `h.goldInk` |
| live green `#25B87A` | `h.live` |
| danger `#C23B3B` (text, outline), `#EE5A5E` to `#C23B3B` gradient (SOS), wash `#FCEBEC` | add `h.danger`, `h.dangerWash` |
| hairlines | existing `h.line06` to `h.line13` |
| rose `#D23F6D`, badge gradient `#E5588A` to `#C93566`, blush `#FDF1F4`, line `#F4D2DC`, selected `#FFE6EE`, ink `#8E1F47`, sub text `#7B5663` | add `h.rose`, `h.roseWash`, `h.roseLine`, `h.roseInk` (rental package tiles only) |

Type: Plus Jakarta Sans only. Weights 400, 500, 600, 700 are loaded in `useAppFonts()`. The design also uses 800 for big numerals (fare totals, ETA, "12 min left"): add `PlusJakartaSans_800ExtraBold` to `useAppFonts()` and `font.xb`. Use `fontVariant: ['tabular-nums']` on every price, time and distance.
Sizes in use: 28/800 page title (tab roots), 20/700 header title, 32/800 hero numeral, 36/800 total, 21/800 option price, 17 to 18/800 price, 16 to 16.5/700 card title, 15/600 row title, 14 to 14.5/600 to 700 body and buttons, 12.5/500 secondary, 12/600 chips. Nothing below 12.
Section labels are sentence case 14/600 ink (the `sectionLabel` recipe). No tracked all-caps anywhere.

Radii: card 20 to 22, large card 24 to 26, sheet 28 to 30 (top corners), primary button 18, soft button 16, chips and pills 999, icon button 44 circle, avatar full circle, icon chip 12 to 15.
Spacing: 18 screen gutter, 12 to 14 gaps between cards, 14 to 16 card padding, 56 top padding to clear status bar on screens without a header, 130 to 300 bottom padding to clear fixed CTA or sheet.
Shadows: `shadow.sm` on cards, `shadow.md` on sheets, CTA glow `0 12px 24px rgba(14,143,163,0.30)`, inset 1px white highlight on cards `inset 0 1px 0 rgba(255,255,255,0.9)`.
Gradients: avatar `#12A0B6` to `#0A7788` (145deg), gold `#F6DC9A` to `#D6A552`, scrim `rgba(20,23,26,0.5)`.

## 4. Components to extract (put in `packages/mobile-shared/src/ui` if the driver app can use them, else `apps/rider-mobile/src/components/ui`)

- `PrimaryButton` (h56, r18, `h.tealCta`, glow) and `SoftButton` (h50, r16, tealWash or chip bg). Extend the existing `Button`.
- `IconButton` (44 circle, white, sm shadow).
- `GroupedList` + `ListRow` (white card r22, rows 40px icon chip, title 15/600, subtitle 12.5, chevron, hairline inset 70px).
- `Chip` / `Pill` (tealWash, chip, gold variants).
- `BottomSheet` (r30 top corners, 36x4 handle, `md` shadow) plus `Scrim`. The existing `SlideModal` may already cover this.
- `ExpandableSection` (max-height reveal, chevron rotate 180deg, `ease.sheet`, 450ms).
- `RouteTimeline` (teal dot, connector line, ink square; numbered amber stop dots; optional trailing action).
- `SnapSlider` (horizontal ScrollView, snapToInterval, peek, scroll to selected on open) used for rental package tiles.
- `PackageTile` (rose blush, selected ring, Best fit badge) and a small gold `Premium` chip.
- `DriverCard` (avatar with gold ring, rating badge hanging below the avatar, name, car and trips, plate chip, car image).
- `TicketBanner` (coupon applied: gradient wash, gold border, round notches, dashed divider before Remove).
- `ReceiptRow` (label, gray detail, tabular amount at width 64).
- `StarRating` (5 stars 36px, gold `#E2A93B` fill, `#E4EAEB` empty).
- `SegmentedControl` (track chip bg r14, selected `h.tealCta` white text).
- `SOSButton` exists: restyle to 48 circle, red gradient, looping ring.

## 5. Behaviour per screen (state to port)

1. Plan trip: drop field is focused (teal border, halo). Tapping a recent or popular row fills drop. Continue goes to trip type. Home / Work chips fill drop from saved places.
2. Trip type: single select. Round trip shows Return on and Driver waits tiles, with `Best fare` gold badge and strikethrough two-way price. CTA text reads `See rides from <selected fare>`.
3. Choose a ride: unavailable vehicles are greyed and not selectable. CTA is `Book <name> · <price>` and always follows the selected vehicle. Offers button opens the coupon sheet. Applied coupon: struck old price, new price, `Save X` chip per card, ticket banner with Remove, offers button shows the code, CTA shows the struck old price. Coupon cap logic: percent coupons are capped, flat coupons have a minimum fare.
4. Driver on the way: sheet collapsed shows ETA, ride PIN, driver card, Message, Call, Share. `Trip details` row (or the handle) expands: route timeline with Add stop and Change, fare and payment line, Cancel ride with policy note. Safety button opens the safety toolkit sheet.
5. On trip: SOS is always visible top right over the map. Sheet shows time left, arrive by, progress bar, the same spacious driver card, Message, Call, safety shield. Expanded: Add stop, Share live trip, route, fare. Cancel is intentionally absent mid-ride. SOS sheet: call 112, alert Ocar safety team, share live trip, I am safe.
6. Chat: quick reply chips append a rider message. Header shows driver, ETA and plate.
7. Trip complete: receipt card (total, paid chip, route strip, perforated divider, breakdown rows, total band, trip id, Get receipt), rating card (stars, tags that change by score, tip segmented control). CTA reads `Submit rating` or `Submit and tip X`.
8. Account: profile hero (avatar gold ring, name, phone, edit), rides and rating strip, Saved places and Offers tiles, grouped Preferences and Support lists, outlined Sign out with confirmation sheet, Delete account as quiet text.
9. Rental (City Rides). Route card: Now chip, distance and time, then pickup, ONE summary row for stops (`N stops`, first two short names, `+N`, `Edit`, and a round `+` button), then drop. The card never grows with the number of stops. `Edit` opens Plan your stops, `+` opens Add a stop (disabled at 8). Vehicles are one vertical list, exactly one open at a time. The open vehicle shows `Choose a package` as a HORIZONTAL SLIDER (any number of packages): 96px tiles, snap to start, 10px gap, the next tile peeks about 18px so riders know it scrolls, `N packages` with a chevron on the label row. Edge arrows: while more tiles exist to the right, a white 32px circle with a teal chevron sits on the right edge over a 64px white fade, and tapping it scrolls forward about two tiles; once the user scrolls away from the start, the same arrow appears on the left (48px fade). Each arrow fades out (opacity .2s) when that end is reached. This is the existing `PackageTierScroller` fade plus arrow, now in both directions. On open, and when the selection changes, scroll so the selected tile is the second visible one (best fit is selected by default, so it is always on screen). Tiles are blush pink with hours, km and price; the selected tile has a rose border and ring; the `recommendPackage` tile carries a rose `Best fit` badge overlapping its top edge. Under the slider: two columns, `Included` (`60 km · 6 hrs`) and `After that` (`₹10/km · ₹2/min`, teal). Then one estimate line from the real route: if the trip fits, a teal check line `Your trip is about 43.3 km and 1h 39m. It fits this package, so no extra charges are expected.`; if not, a gold line that names the km and minutes over, the estimated extra (km over x km rate + minutes over x minute rate) and says it is billed after the ride. The CTA always shows the package fare only. The premium category (slug `luxury`) is an ordinary row in the same list, same card and same package panel as the others, with a small gold `Premium` chip (star icon) after the seat count. No showcase, no separate section. Bottom bar: Cash button and Offers button side by side (Offers shows the code once applied), then `Book <vehicle> · <price>` with the struck old price when a coupon applies. The offers sheet is the same one as Choose a ride.
10. Plan your stops: header with `n of 8` chip (turns gold at 8), an estimate strip (`Estimated trip` distance and time, and the live `Best fit` package), one list card: pickup (teal dot), numbered stops (amber circles, `Stop n` label, address, move later and remove buttons, 36px targets), drop (ink square). `Add a stop` (outline, disabled at 8 with an explanatory line) and `Done` sit in a sticky bar. The list scrolls inside the page, so 8 stops never break the layout. Use the existing `swapStop` and `removeStop`.
11. Add a stop: header with `Stop n of 8` chip, a focused search field, then `Select on map`, Home and Work chips, Recent and Popular lists. Typing swaps the lists for `Results` with the matched part bold in teal and a distance on the right. Tapping a row adds the stop and returns to Plan your stops.

## 6. Feature gaps (checked against the repo on the day this pack was made)

Exists already, reuse: Add stop (`AddStopSheet`, `add-stop.tsx`), Cancel (`CancelSheet`), Edit pickup (`EditPickupSheet`), SOS (`SOSButton`, `triggerSos`, safety contacts in `safety.tsx`), rating tags from API (`fetchRatingTags`: use the API tags, not the static list in the design), round trip and rental flows, chat, notification settings (has an Offers toggle), saved places.

Does NOT exist, build UI only and stub:
- Coupons and offers: no coupon code anywhere in the rider app or API. Build the sheet, ticket banner and discounted price rendering driven by an optional `appliedCoupon` prop. Do not compute discounts client side in production.
- Tip on the rating screen: confirm whether `submitRating` or ride payment supports it; if not, UI only and hidden behind a flag.
- Get receipt, Trip ID display: confirm fields in the ride payload.
- Round trip "Save X vs two one-way rides": derive from existing return-cab estimates if available; otherwise hide the chip.
- "Fare locked" message: only show if the fare estimate is actually locked at booking.
- Driver trips count, "Share live trip", "Change drop" mid-trip: check the ride payload and existing actions; hide what is not supported.
- Account: the design removes the wallet entirely. Remove it from the UI only (profile currently shows a Wallet stat). Do not delete the data fetching without asking.
- Rental stops up to 8: the API caps a ride at `MAX_STOPS_PER_RIDE = 3` (`api/src/constants/limits.ts`, enforced in `rides.service.ts`, and `rides.service.ts` has a stop ordering routine that assumes a small count). The mobile `MAX_STOPS` in `rental.tsx` is 3 as well. The designs show 8. Do the UI against a single `MAX_STOPS` constant, and raise the limit on the backend first (check the ordering routine, fare and ETA math for 8) before raising it in the app. Until then the app simply hits the limit at 3 and the design still holds.
- Rental `RentalPackage` already has `packageFare`, `extraPerKm`, `extraPerMin`, `kmLimit`, `durationMinutes`: the Included and After that columns and the overage estimate need no new API. Estimated extra = km over x `extraPerKm` + minutes over x `extraPerMin` (client side estimate, label it estimated).
- Premium: only a `Premium` chip next to the seats on the existing `luxury` category row (`isPremiumSlug`). Nothing else changes for it.
- Package tiles show the price of each tier (`packageFare`), which the current tile does not.
- Auto Rickshaw, Luxury and Van rows are designed on the Rental screen only (using the real icons from `packages/mobile-shared/src/assets/vehicles`). The Choose a ride screen still shows Hatchback, Sedan, SUV: keep the existing categories from `fleet.ts` and style them with the same card.

## 7. Intentional deltas from `DESIGN.md`

The approved designs differ from the current `DESIGN.md` in these places. The design wins. List each one in the PR and add a line to the Decisions Log in `DESIGN.md`.
1. Primary buttons are 56px tall with 18px radius (not full pill).
2. Shadows follow `@ocar/mobile-shared` `shadow` tokens (neutral ink alpha), as on the approved Home, not the teal-tinted shadow rule. Only the CTA glow is teal.
3. Gold (`#D6A552`) is used in the user flow for `Best fare`, `Best value`, coupon banner and driver avatar ring. Orange is still not used.
4. Hero numerals use Plus Jakarta Sans 800 instead of Space Grotesk.
5. Danger red is `#C23B3B` for outlined actions and SOS, not `#EF4444`.
6. Tracked all-caps labels were removed from the design already, so no delta there.
7. Rose pink (`#D23F6D` border and badge gradient `#E5588A` to `#C93566`, blush `#FDF1F4` tile, border `#F4D2DC`, selected tile `#FFE6EE`, ink on selected `#8E1F47`) is used only for rental package tiles and their `Best fit` badge. Add `h.rose`, `h.roseWash`, `h.roseLine`, `h.roseInk`. It was a product call, not a brand colour, so keep it out of every other screen.

## 8. Acceptance checklist per screen

- Side by side with the screenshot at 390 wide and at a small Android (360) and large (412): no clipped text, no overlap with the sheet or tab bar.
- All touch targets 44px or larger.
- Every network request, store write and navigation call is identical to before (diff the call sites).
- Loading, empty and error states still exist and use the same skeleton or error components, styled to match.
- Long names and addresses truncate with ellipsis on one line.
- Dark mode is out of scope.
- `typecheck`, `lint`, `test` pass.
