# Deployment strategy update — blue/green, and answers to your questions

Two things in one note: why the deployment strategy changed since the infrastructure handover
document, and direct answers to the three points you raised.

---

## Why this changed

The handover document's Section 7.3 explains why we originally chose rolling replacement over
blue/green, and one of the reasons given was: *"An atomic blue/green cutover disconnects every
connected rider and driver simultaneously."*

That's true of a naive blue/green implementation — stand up a new environment, flip traffic,
tear the old one down immediately. It is not true of what we built in response to your questions.
The design specifically closes that gap:

- The old environment is **not torn down at cutover**. It keeps running and keeps serving
  connections it already holds.
- Only **new** connections move to the new environment at the moment of cutover — existing
  driver/rider sessions finish naturally and reconnect on their own (standard Socket.io client
  behavior), over a bounded window, not all at once.
- The old environment is only scaled down once the new one has been observed error-free for a
  full bake period.

So the objection in Section 7.3 was correct against the general case — we didn't dismiss it, we
built around it. Worth being upfront: this is a real change from what the handover document says,
not an oversight in it. That section is now superseded by this note.

---

## Your three points, answered directly

**1. Is scale-up/scale-down of instances automated, or does it need manual intervention?**

Fully automated, no manual step in the normal path or the automatic-rollback path. The deploy
pipeline scales the new environment up, health-checks it, smoke-tests it against the real
database, and only then flips traffic — and if anything fails at any of those stages, it
automatically scales back down and leaves the live environment untouched. If the *new*
environment itself starts erroring after the flip, the pipeline automatically flips back within
seconds, without anyone watching it.

**2. Blue/green was introduced to solve instance-termination guarantees — do we have confidence
in it, and have we implemented custom termination policies?**

We don't rely on any implicit or optional AWS setting for this. The old environment's shutdown is
an explicit step the pipeline itself issues — not something we hoped a platform default would
handle. Two specific mechanisms we confirmed directly rather than assumed:

- AWS's scale-in protection and any instance-level termination protection are both off by
  default and unused in this setup — nothing blocks or delays the pipeline's own scale-down
  command.
- Because our scale-down is always a full "reduce to zero," AWS's termination-*policy* question
  (which instance to pick, out of several) never actually applies — every instance in the
  retiring environment gets terminated, not a subset chosen by some rule we'd have to get right.

**3. For a quick fix, deploying during business hours risks a higher error rate — how do you know
an instance isn't serving traffic before it's terminated?**

Directly: we don't get a *guarantee* of zero in-flight requests, and no deployment strategy does
without extra work most teams don't build. What actually happens: the load balancer stops sending
an instance *new* requests immediately, then gives whatever's already in flight a fixed grace
window to finish before force-closing anything left — the same mechanism used by every AWS load
balancer setup, blue/green or not. For a stateless REST API where requests are normally
sub-second, that window is a large safety margin, not a tight one. If you want a stronger
guarantee than a generous timeout — actively confirming zero active connections before
terminating, rather than trusting the window — that's a real, buildable enhancement, and we're
happy to scope it if you'd like it.

What blue/green actually changes, versus the rolling deploy: it removes the window where brand
*new* connections could land on a random mix of old and new code during a multi-minute rollout.
That's a different problem than the one in point 3 (which is about finishing existing work
gracefully) — blue/green doesn't make that one better or worse, it was already handled the same
way before.

---

## Where this stands right now

This has been built, deployed to production, and verified working — including one deliberately
observed failure during the process (a permissions gap that made the pipeline fail safely with
zero customer impact, caught and fixed live) and one fully successful end-to-end run afterward,
watched step by step: migration, environment scale-up, health check, smoke test against the real
database, listener cutover, and a clean bake with no rollback triggered. Both attempts left
production undisturbed throughout.
