# VeggieTrack status

Last reviewed: 2026-09-19

The working tree contains the email-only authentication, mobile UI, delivery-proof and reliability updates. Local automated checks and a fresh Expo web export pass. Hosted deployment and physical-device acceptance remain outstanding, so this is not a production-readiness sign-off.

## Current implementation

| Area | Status |
|---|---|
| Four business roles | Farmer, distributor, retailer and rider workflows remain implemented locally. |
| Email accounts | Registration uses email/password and email confirmation; existing phone-change UI and phone identity requirements have been removed. |
| Sign-in and recovery | Password sign-in sends a follow-up email code in the app; password recovery uses a Supabase email link and native PKCE deep link (`veggietrack://reset-password`). |
| Account approval | Newly confirmed accounts move to pending approval; distributor approval/status checks continue to gate API access. |
| Delivery proof | Photo, valid fresh GPS coordinates, accuracy and timestamp remain mandatory. Distance is stored and classified verified/unverified, but no longer blocks completion. |
| Mobile UX | Updated dashboards, profiles, stock, order, message, notification and delivery components build in the web bundle. |

The email sign-in code is an application UI challenge, not server-enforced MFA or an elevated Supabase AAL. It must not be represented as a security control against a client that calls Supabase Auth directly.

## Verification performed

| Check | Result |
|---|---|
| Backend regression suite | Passed after serializing PGlite workers to avoid Node out-of-memory failures. It covers delivery proof, migrations, pickup proof, Auth, inventory, requests and mobile handler regressions. |
| Legacy import regression | Passed after updating its test fixture to use the active distributor UUID rather than the retired seed UUID. |
| Backend syntax | `node --check` passed for `backend/index.js` and every `backend/lib/*.js` file. |
| Expo health check | `npx --no-install expo-doctor` completed successfully. |
| Mobile build | `npx --no-install expo export --platform web --output-dir .expo/verification/web` completed successfully (935 modules). |
| Formatting | `git diff --check` has no whitespace errors. |

## Hosted database state

A read-only inspection on 2026-09-19 (`backend/scripts/inspect_runtime_contract_readonly.js`, plus the two existing delivery/auth inspection scripts) found the hosted Supabase project **already migrated** for everything the API calls at runtime. All 13 tables and all 7 RPCs resolve, including `complete_delivery_with_proof`, `complete_pickup_with_proof`, `advance_delivery_status`, `vt_account_context` and `vt_admin_transition`, and the destination snapshot, rider accuracy, POD and avatar columns. Earlier revisions of this report described these as missing; that is no longer accurate. **Do not reapply the delivery or Auth migrations.**

One migration is still outstanding: `deliveries.rejection_reason` and `deliveries.rejected_at` from [delivery_reject.sql](backend/sql/delivery_reject.sql) do not exist hosted. `PUT /api/deliveries/:id/reject` now falls back to an audit-free hand-back and reports a real failure instead of silently reporting success, but apply the migration to record reject reasons.

## Deployment prerequisites

1. Apply [delivery_reject.sql](backend/sql/delivery_reject.sql) — two additive `ADD COLUMN IF NOT EXISTS` statements. No other SQL is outstanding; see "Hosted database state" above.
2. In Supabase Auth, enable Email/password and email confirmation, add `veggietrack://reset-password` as an allowed redirect URL, and configure production SMTP. The default email service is rate-limited.
3. Resume the suspended Render service at `https://veggietrack-api.onrender.com` — it currently answers every request with `503 / x-render-routing: suspend-by-user`. `mobile/.env` points `BACKEND_URL` at this host, so the app cannot reach the API until it is running.
4. Rebuild the mobile app after the Auth configuration and backend are live. `BACKEND_URL` is inlined at bundle time by `react-native-dotenv`, so the build must not reuse a stale Metro cache.
5. Perform native-device acceptance for registration, email confirmation, sign-in code, reset link, camera/GPS proof, Cloudinary, account approval and cross-role delivery tracking.

## Known limits

- SMTP, native permissions and real-device flows were not exercised here. Cloudinary is known working: hosted batch photos resolve from the configured cloud.
- Background/locked-phone tracking, offline navigation, voice guidance and live traffic ETA are not implemented.
- Main mobile has no dedicated lint or typecheck script.
- Historical fresh-database setup is incomplete for some hosted-only address/tracking structures; use the guarded rollout after inspection if you ever rebuild the database from scratch.
- The `qa.farmer` / `qa.rider` / `qa.retailer` `@veggietrack.test` accounts no longer bypass the email sign-in code. That domain receives no mail, so those accounts can no longer complete a fresh sign-in.
