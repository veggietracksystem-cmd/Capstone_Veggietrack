# VeggieTrack status

Last reviewed: 2026-09-20

The working tree contains the email-only authentication, mobile UI, localization, delivery-proof and reliability updates. Local automated checks and a fresh Expo web export pass. The hosted API is live; one additive migration, Supabase Auth configuration and physical-device acceptance remain outstanding, so this is not a production-readiness sign-off.

## Current implementation

| Area | Status |
|---|---|
| Four business roles | Farmer, distributor, retailer and rider workflows are implemented. |
| Email accounts | Registration uses email/password and email confirmation; the former phone-change UI and phone identity requirements have been removed. |
| Sign-in and recovery | Password sign-in sends a follow-up email code in the app; password recovery uses a Supabase email link and native PKCE deep link (`veggietrack://reset-password`). Edit Profile's "Change password" reuses that same emailed link. |
| Account approval | Newly confirmed accounts move to pending approval; distributor approval/status checks continue to gate API access, with an audit trail per account. |
| Delivery proof | Photo, valid fresh GPS coordinates, accuracy and timestamp are mandatory. Distance is stored and classified verified/unverified, but no longer blocks completion. |
| Pickup proof | Rider farm pickups use the same photo + GPS capture pipeline, completed through `complete_pickup_with_proof`. |
| Delivery reject | A rider must supply a reason; the delivery is handed back to the distributor and the distributor is notified. Persisting the reason needs the outstanding migration below. |
| Order cancel and expiry | A `pending` order can be cancelled by its retailer or by the distributor (reason required), restoring stock under an atomic guard. Separately, pending, approved or assigned orders whose preferred schedule has passed are cancelled on the next order read or write, so a stale assignment cannot stay actionable. |
| Localization | English and Tagalog string tables with a Profile-screen switcher persisted to AsyncStorage. Coverage is partial — the auth, account-management, application-status and tracking screens are still English-only. |
| In-app help | A translated per-role User Guide and FAQ modal. The Contact Us modal shows hub address, phone, email and hours, but its inquiry form is presentation only and sends nothing. |
| Offline and freshness | One `SyncProvider` revalidates every 30 s, on reconnect and on foreground, and replays the queued offline harvests. Notifications poll every 30 s and messages every 3–5 s; nothing is realtime and there is no push notification. |
| Mobile UX | Updated dashboards, profiles, stock, order, message, notification and delivery components build in the web bundle. |

The email sign-in code is an application UI challenge, not server-enforced MFA or an elevated Supabase AAL. It must not be represented as a security control against a client that calls Supabase Auth directly.

## Verification performed

Re-run on 2026-09-20 against the current working tree.

| Check | Result |
|---|---|
| Backend regression suite | **124 passed, 0 failed** (`npm test --prefix backend`, ~73 s). It covers delivery proof, pickup proof, migrations, Auth, avatars, inventory, checkout, stock safety, requests and mobile handler regressions. PGlite workers stay serialized to avoid Node out-of-memory failures. |
| Backend syntax | `node --check` passed for `backend/index.js` and every `backend/lib/*.js` file. |
| Mobile build | `npx --no-install expo export --platform web` completed successfully. |
| Formatting | `git diff --check` reports no whitespace errors. |
| Expo health check | `npx --no-install expo-doctor` completed successfully on 2026-09-19; not re-run today. |

## Hosted database state

A read-only inspection on 2026-09-19 (`backend/scripts/inspect_runtime_contract_readonly.js`, plus the two existing delivery/auth inspection scripts) found the hosted Supabase project **already migrated** for everything the API calls at runtime. All 13 tables and all 7 RPCs resolve, including `complete_delivery_with_proof`, `complete_pickup_with_proof`, `advance_delivery_status`, `vt_account_context` and `vt_admin_transition`, and the destination snapshot, rider accuracy, POD and avatar columns. Earlier revisions of this report described these as missing; that is no longer accurate. **Do not reapply the delivery or Auth migrations.**

One migration is still outstanding: `deliveries.rejection_reason` and `deliveries.rejected_at` from [delivery_reject.sql](backend/sql/delivery_reject.sql) do not exist hosted. `PUT /api/deliveries/:id/reject` now falls back to an audit-free hand-back and reports a real failure instead of silently reporting success, but apply the migration to record reject reasons.

For the handover to real client accounts there is a new, irreversible script, [reset_test_data_keep_distributor.sql](backend/sql/reset_test_data_keep_distributor.sql). It clears all business data and every account except the trusted distributor that `backend/lib/auth.js` hardcodes. It is not a migration — take a database backup first, and clear Cloudinary media separately. Do not use the older `reset_data.sql`, which truncates `users` and would remove that distributor.

## Uncommitted working-tree changes

Beyond the documentation, the tree currently holds build/branding changes that are not yet committed: the Android adaptive-icon background in `mobile/app.json` moved to `#FFFFFF` with the regenerated launcher assets, `mobile/app.json` gained `"owner": "veggietrack"`, and the EAS `preview` profile now sets `android.buildType: "apk"` so preview builds produce an installable APK rather than an AAB. `backend/sql/reset_test_data_keep_distributor.sql` and the local diagram sources under `docs/` are also untracked.

## Deployment prerequisites

1. Apply [delivery_reject.sql](backend/sql/delivery_reject.sql) — two additive `ADD COLUMN IF NOT EXISTS` statements. No other SQL is outstanding; see "Hosted database state" above.
2. In Supabase Auth, enable Email/password and email confirmation, add `veggietrack://reset-password` as an allowed redirect URL, and configure production SMTP. The default email service is rate-limited.
3. Point `BACKEND_URL` at `https://capstone-veggietrack.onrender.com`, the live API. Verified 2026-09-20: it answers `/api/auth/me` with `401`, so the service is running and correctly rejecting unauthenticated requests. The host recorded in earlier revisions of this report, `https://veggietrack-api.onrender.com`, is a different and wrong service; it remains suspended (`503 / x-render-routing: suspend-by-user`) and must not be resumed. `mobile/.env` has been corrected. Update the EAS environment variable separately: [.easignore](.easignore) excludes `**/.env` from the build upload, so the APK reads `BACKEND_URL` from the EAS environment rather than the local file.
4. Set `EXPO_PUBLIC_GEOAPIFY_API_KEY` in the same EAS environment if address autocomplete should work in the build; without it, address entry falls back to manual map pinning.
5. Rebuild the mobile app after the Auth configuration and backend are live. `BACKEND_URL` is inlined at bundle time by `react-native-dotenv`, so the build must not reuse a stale Metro cache.
6. Perform native-device acceptance for registration, email confirmation, sign-in code, reset link, camera/GPS proof (delivery *and* farm pickup), Cloudinary, account approval, cross-role delivery tracking and the language switcher.

## Known limits

- SMTP, native permissions and real-device flows were not exercised here. Cloudinary is known working: hosted batch photos resolve from the configured cloud.
- Background/locked-phone tracking, offline navigation, voice guidance and live traffic ETA are not implemented.
- Messaging and notifications are poll-based; there is no Supabase Realtime subscription and no push notification.
- The Contact Us inquiry form does not deliver messages — it is UI only. The hub address, phone and email it displays are placeholder contact details.
- Tagalog coverage is incomplete; the authentication and tracking screens remain English-only.
- Main mobile has no dedicated lint or typecheck script.
- Historical fresh-database setup is incomplete for some hosted-only address/tracking structures; use the guarded rollout after inspection if you ever rebuild the database from scratch.
- The `qa.farmer` / `qa.rider` / `qa.retailer` `@veggietrack.test` accounts no longer bypass the email sign-in code. That domain receives no mail, so those accounts can no longer complete a fresh sign-in.
