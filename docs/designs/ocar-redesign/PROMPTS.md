# Prompts for Claude Code

Run from `C:\ocar`. Paste one at a time. Approve each plan before the next step.

## Step 0: plan only (use plan mode)

```
Read CLAUDE.md, DESIGN.md and docs/designs/ocar-redesign/DESIGN_BRIEF.md. Then look at every file in docs/designs/ocar-redesign/screens and every PNG in docs/designs/ocar-redesign/screenshots.
Do not write code yet. Produce a plan:
1. For each of the 8 design screens, confirm the repo files to restyle (the brief has a map, correct it if wrong).
2. For each screen, list the existing logic, hooks, stores, socket events and navigation params that must stay untouched.
3. List which brief section 6 features exist or are missing, after checking the code yourself.
4. List every place the design differs from DESIGN.md (brief section 7) and any I missed.
5. Propose the order: tokens, shared components, then screens one at a time, one commit each.
Wait for my approval.
```

## Step 1: tokens and shared components

```
Implement step 1 of the approved plan. Add the missing tokens to @ocar/mobile-shared (brief section 3), load PlusJakartaSans_800ExtraBold, and build the shared components from brief section 4. Extend the existing Button, Card, FloatingTabBar, SOSButton and SlideModal instead of duplicating them.
Add a throwaway dev-only screen at src/app/dev-ui.tsx that renders every component in its variants so I can eyeball it on device. Do not touch any real screen yet.
Run typecheck, lint, test. Commit.
```

## Step 2 onward: one screen at a time (template)

```
Implement screen <N> (<name>) from docs/designs/ocar-redesign/screens/<File>.dc.html in the repo files listed for it in DESIGN_BRIEF.md section 1.
Rules:
- Restyle only. Keep every hook, API call, store write, socket handler and navigation call exactly as is. If you must move code, move it without changing behaviour.
- Match px values, colors, radii, copy and states from the .dc.html. Compare against screenshots/<N>*.png.
- Port the UI state logic in the script block (renderVals) to useState. Replace sample data with real data.
- Anything in brief section 6 marked missing: build the UI behind an optional prop, mark TODO(backend), do not invent endpoints.
- Reuse the shared components from step 1.
When done: run typecheck, lint, test, then give me (a) a list of files changed, (b) a before and after list of call sites to prove behaviour is unchanged, (c) everything stubbed, (d) any deviation from the design and why. Then commit.
```

Suggested order and the filled-in first line:

```
Screen 8 (Account) from screens/Account.dc.html
Screen 1 (Plan your trip) from screens/Main.dc.html
Screen 2 (Trip type and fare) from screens/TripType.dc.html
Screen 3 (Choose a ride, offers sheet, coupon applied) from screens/Vehicles.dc.html and screens/VehiclesCoupon.dc.html
Screen 4 (Driver on the way) from screens/Driver.dc.html
Screen 5 (On trip with SOS) from screens/Ride.dc.html
Screen 6 (Chat) from screens/Chat.dc.html
Screen 7 (Trip complete and rating) from screens/Complete.dc.html
```

Account goes first because it has the least live logic, so it proves the tokens and components before you touch the booking and ride flow.

## Final check

```
Review the whole redesign branch against docs/designs/ocar-redesign/DESIGN_BRIEF.md section 8.
1. For each screen, diff network calls, store writes, socket events and navigation before and after (git diff against main). Report any change.
2. List every TODO(backend) stub.
3. List every spot where the screen does not match its screenshot.
4. Update the Decisions Log in DESIGN.md with the deltas from brief section 7.
```
