---
timestamp: 2026-06-22T14-15-55Z
slug: apps-driver-src
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | StatusBar, pulse dot, timer bar, spinners solid. No app-level toast system. |
| 2 | Match System / Real World | 4 | Plain driver language throughout. |
| 3 | User Control and Freedom | 3 | Back buttons, go-offline confirm, OTP cancel. No undo on ride accept/decline. |
| 4 | Consistency and Standards | 3 | Token fix resolved most drift. DatePickerSheet and OTPVerify still carry old blue. |
| 5 | Error Prevention | 3 | Pre-ride checklist, validation, rate-limit feedback. |
| 6 | Recognition Rather Than Recall | 3 | Labeled nav, StatusBar always visible, onboarding progress bar. |
| 7 | Flexibility and Efficiency | 2 | Mobile-only one-path workflows. Acceptable for use case. |
| 8 | Aesthetic and Minimalist Design | 3 | Competing accents removed. OTPVerify blue box and DatePickerSheet blue remain. |
| 9 | Error Recovery | 3 | Inline OTP errors, field hints, auto-step-back on expired OTP. |
| 10 | Help and Documentation | 2 | Pre-ride checklist good. No in-app help for new drivers. |
| Total | | 29/40 | Good — address weak areas |

## Priority Issues

[P2] DatePickerSheet blue selected state — fix rgba(37,99,235,...) to slate
[P2] OTPVerify blue icon box — fix gradient and shadow to slate
[P2] EarningsCard dead code with violations — delete or fix
[P3] Home quick-action buttons use off-token #F8FAFF
