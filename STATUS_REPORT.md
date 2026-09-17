Last reviewed: 2026-09-16

# VeggieTrack status

The main application in `mobile/` includes the four business roles, Supabase authentication, profile photos, delivery reliability fixes and asynchronous screen updates. Local automated verification passes. **Hosted deployment and physical-device acceptance remain pending; this is not a production-readiness sign-off.**

This review covers the current working tree, including uncommitted changes. Only `README.md` and `STATUS_REPORT.md` were edited for this documentation update.

## Implementation status

| Area | Current local implementation |
|---|---|
| Farmer | Harvest management, pickup requests, history/reports, offline caching and serialized queue replay |
| Distributor | Pickup assignment, traceable inventory, listings, order approval/rejection, rider assignment, payments and account management |
| Retailer | Marketplace/cart, minimum 5 kg checkout, future delivery schedule, saved address pins, orders and tracking |
| Rider | Pickup and delivery tasks, restored pickup-card rendering, current-leg navigation and proof-of-delivery submission |
| Shared accounts | Supabase phone/password login, OTP flows, account approval/status checks, verified phone changes and staged profile photo uploads |
| Asynchronous UI | Request locks, stale-response guards, refresh on return, retained input/data on failures, and message/notification race protection |

See [AJAX_IMPLEMENTATION_REPORT.md](AJAX_IMPLEMENTATION_REPORT.md) for screen coverage and [DELIVERY_RELIABILITY_REPORT.md](DELIVERY_RELIABILITY_REPORT.md) for delivery implementation details.

## Delivery behavior

The current delivery policy is a 100 m base radius plus at most 50 m GPS allowance, with accuracy limited to 100 m and samples no older than 60 seconds. Completion and tracking resolve the same order destination. Upload retries preserve the photo and successful Cloudinary upload; completion requires backend confirmation. Current-leg LIVE ETA targets the warehouse before pickup and the destination afterward; OSRM failure leaves GPS available.

## Verification

| Check | Result and evidence |
|---|---|
| Backend regression suite | Rerun on 2026-09-16 for this documentation update: **116 passed, 0 failed, 0 skipped** using `npm.cmd test --prefix backend` |
| Local PostgreSQL/PGlite | Included in the passing suite: schema history, delivery proof, Auth and avatar integration checks |
| Mobile regression coverage | Included in the suite: handler races, request locking, offline replay, profile uploads, POD/GPS and module compilation |
| Expo production bundles | Web, Android and iOS/Hermes passed as recorded in the asynchronous UI report; not rerun for this documentation-only update |
| Backend syntax and starter lint/typecheck | Passing results recorded in the implementation reports; not rerun for this documentation-only update |
| Main mobile lint/typecheck | No configured scripts |
| Hosted end-to-end and physical devices | Not verified by this update; provider, permissions, native release and two-device acceptance remain outstanding |

The delivery report's earlier count of 106 tests predates the additional asynchronous UI regressions. The current suite has 116 tests. Automated handler and local database checks do not establish that every hosted screen or provider integration works on a real device.

## Deployment status

The September 16 read-only hosted inspection recorded in the delivery report found order snapshot coordinates, rider accuracy, POD and completion/status RPCs absent. The hosted database was not re-inspected or modified during this documentation update. Re-run and review the read-only inspection before applying the [combined rollout](backend/sql/delivery_location_policy.sql), then deploy the API and mobile build. Abort if the schema is incompatible. Do not reapply the historical proof function afterward.

Avatar columns were present in the latest recorded hosted inspection. The avatar implementation is complete locally; real-device upload and hosted trigger/RLS definitions remain unverified. See [CHUNK1_AVATARS_REPORT.md](CHUNK1_AVATARS_REPORT.md); its current-status note supersedes older findings in that file.

Supabase authentication remains the current implementation; [AUTH_SUPABASE_SETUP.md](AUTH_SUPABASE_SETUP.md) contains its separate deployment/manual validation requirements. The asynchronous UI updates require no new migration. No migration, deployment, SMS or real photo upload was performed during this documentation update.

## Remaining acceptance checks

- Hosted migration/deployment and real Cloudinary unsigned-preset validation.
- Native release/EAS build and rider/viewer two-device test.
- Actual GPS permissions, poor reception, camera/file handling, connectivity loss and session expiry.
- Four-role hosted smoke tests, including repeated taps, failed-form retries, retained search/filter selections, messages and notifications; use the checklist in the asynchronous UI report.
- Background/locked-phone tracking, voice guidance, offline maps and traffic ETA are not implemented.
- Historical fresh-database setup is incomplete for hosted-only address/tracking structures; the guarded delivery rollout targets inspected existing installations.
- Pickup batch creation and checkout inventory writes retain pre-existing multi-step operations; full transactional failure recovery remains separate work.
- The delivery report records starter dependency advisories and deprecated tooling; these were not reassessed or force-upgraded in this documentation update.

## Next steps

1. Inspect the target Supabase schema and apply the guarded delivery migration if its prerequisites match; verify Auth and avatar setup separately.
2. Configure backend/mobile environment variables and the Cloudinary unsigned image preset using the README and [EAS build notes](mobile/EAS_BUILD.md).
3. Deploy the API and rebuild the mobile app with the intended environment.
4. Run the delivery report's rider/viewer two-device test and the asynchronous UI report's four-role acceptance checklist.
