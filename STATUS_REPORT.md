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

## Deployment prerequisites

1. Inspect the target Supabase project before applying SQL. Apply [email_otp_verification_migration.sql](backend/sql/email_otp_verification_migration.sql), then [email_only_auth_migration.sql](backend/sql/email_only_auth_migration.sql), only if the existing Auth migration prerequisites match.
2. Apply [delivery_location_policy.sql](backend/sql/delivery_location_policy.sql), then [delivery_proof_relax_radius_migration.sql](backend/sql/delivery_proof_relax_radius_migration.sql). Do not reapply historical delivery-proof functions afterward.
3. In Supabase Auth, enable Email/password and email confirmation, add `veggietrack://reset-password` as an allowed redirect URL, and configure production SMTP. The default email service is rate-limited.
4. Deploy the backend and rebuild the mobile app after the database/Auth configuration is complete.
5. Perform native-device acceptance for registration, email confirmation, sign-in code, reset link, camera/GPS proof, Cloudinary, account approval and cross-role delivery tracking.

## Known limits

- Hosted schema state, SMTP, Cloudinary, native permissions and real-device flows were not modified or exercised here.
- Background/locked-phone tracking, offline navigation, voice guidance and live traffic ETA are not implemented.
- Main mobile has no dedicated lint or typecheck script.
- Historical fresh-database setup is incomplete for some hosted-only address/tracking structures; use the guarded rollout after inspection.
