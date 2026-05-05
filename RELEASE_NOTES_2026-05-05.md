# ConnectHub Release Notes - 2026-05-05

## Release Summary

This release ships major product polish across core user and admin surfaces, plus KYC routing hardening and one-time migration tooling.

## Included Changes

- KYC routing consistency fixes using `kyc_submissions` status precedence.
- KYC guard hardening for direct route access to step pages.
- One-time KYC sync tooling and npm scripts:
  - `migrate:kyc:dry`
  - `migrate:kyc`
  - `migrate:kyc:repair:dry`
  - `migrate:kyc:repair`
- UI/UX overhaul for:
  - Home
  - Request Wizard
  - My Requests
  - Wallet
  - Providers
  - Provider Setup
  - Notifications
  - Profile
  - Subscription
  - Referral
  - Payments
  - Admin
- Admin tab alignment update:
  - Replaced Push Tools tab with Users tab and user directory summary.

## Deployment

- Hosting URL: https://connecthub-1873e.web.app
- Latest commits:
  - `b65d917`
  - `f707238`

## QA Smoke Results (Web)

Validated from logged-in session on localhost:

- PASS: Authenticated dashboard loads.
- PASS: Request Wizard route renders (stepper and category selection visible).
- PASS: My Requests route renders and state tabs display.
- PASS: Providers route renders with search, categories, and sort controls.
- PASS: Wallet route renders with hero balance, stats cards, and grouped history shell.
- PASS: Profile route renders with overview cards and settings actions.
- PASS: Subscription route renders all plan cards and upgrade CTAs.
- PASS: Referral route renders code card, stats, and referred-users section.
- PASS: Payments route renders filters, verify input, and records list.
- PASS: Admin route renders Requests, KYC, Disputes, Users tabs.
- PASS: KYC route guard verified. Navigating to `/kyc/step1` redirects verified user to `/home`.

## Known Issues / Observations

- Notifications route surfaced a Firestore runtime error for the current test user:
  - `FirebaseError: [code=permission-denied]: Missing or insufficient permissions.`
- Repeated Firestore long-poll request abort events (`net::ERR_ABORTED`) observed during route transitions.
- React Native web warnings present:
  - `shadow* style props are deprecated. Use boxShadow.`
  - `props.pointerEvents is deprecated. Use style.pointerEvents`
- Expo web warning:
  - Push token change listeners are not fully supported on web.

## Recommended Immediate Follow-ups

1. Update Firestore rules/path usage for notifications to resolve permission-denied for normal users.
2. Convert legacy web style props to remove deprecated `shadow*` and `pointerEvents` warnings.
3. Keep push-token listener logic platform-gated to non-web where applicable.
