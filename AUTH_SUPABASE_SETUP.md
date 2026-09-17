Last reviewed: 2026-09-16

## Delivery/API reliability review

The API client now supports cancellation and 30-second request timeouts while preserving current-session 401 sign-out and account-blocked behavior. Network/server failures do not sign users out. Delivery submission explicitly distinguishes session expiry from connectivity failure. Auth/security regression tests still pass; no auth migration, credential change or SMS send was performed in this delivery task. See [DELIVERY_RELIABILITY_REPORT.md](DELIVERY_RELIABILITY_REPORT.md) for delivery rollout prerequisites. Hosted avatar columns are present in the latest read-only schema audit.

# Supabase Auth + PhilSMS deployment

## Implemented; deployment remains manual

New users: register as Farmer/Rider/Retailer -> Supabase SMS OTP -> pending approval -> distributor approves -> active. Normal login is phone + password. Recovery uses Supabase phone OTP, then Supabase password update.

Existing users: the migration explicitly grandfathers the 12 reviewed profiles. It preserves every `public.users.id`, role and business relationship. The sole distributor remains `0a417507-1437-4d71-9e11-185f13a0a262`. All 12 supplied credential-format results were bcrypt-shaped; actual hosted Auth imports and password login still require deployment validation.

Phone change: Edit Profile -> Change Number -> review current/new number -> **Send Verification Code** -> new-number OTP -> Auth verifies -> database trigger updates the existing profile and masked audit event atomically. A duplicate or rejected synchronization rolls back the Auth phone change. No historical contact snapshots are rewritten. Pending/declined/disabled users have only the status screen; changing phone through Profile is limited to active accounts.

No production SQL, credential import, deployment, sign-in or SMS test was performed by Codex. All automated provider calls were mocked. The ignored local mobile `.env` now contains the existing project URL and a validated public anon key; no server secret was copied.

## Security boundary

- Express validates the Supabase token with `auth.getUser`, then reads the current database account and the Supabase session record on every protected request. Cached user metadata does not grant access.
- Database access by mobile is deliberately through the existing Express API. All inspected business tables receive enabled RLS, revoked direct client privileges, and a restrictive deny policy for `anon`/`authenticated`. Existing Express ownership/role checks remain. Service-role credentials stay on the server.
- Public signup metadata cannot grant distributor, active status, legacy access or verified status. The Auth insert trigger accepts only the three public roles.
- Approve/decline/disable/reactivate use a transaction, row locks, a version check and audit insertion. Reasons for decline/disable are user-facing. The distributor cannot disable itself through these actions.
- Disable blocks subsequent requests using existing tokens. Reactivation keeps a login cutoff; refreshing an old session cannot bypass it. A fresh Supabase login is required.
- New assignments require active users through database triggers. Existing unfinished assignments remain and are shown in the Disabled users view.
- OTPs/passwords are never generated or compared by application code. The hook has no payload/provider logging. It verifies Standard Webhooks signatures over the raw request body and rejects HTTP/provider failures.
- Phone change uses an authenticated Supabase session plus OTP at the new number. No custom password reauthentication was invented; the phone update SDK does not expose the password-update `current_password` option. The synchronization trigger requires the pending Auth phone-change transition to be consumed, and rejects direct unverified phone replacement.

## Ordered deployment checklist

Commands below are PowerShell commands. Repository root:
`C:\Users\User 1\Desktop\capstone project\Capstone_VeggieTrack`.

1. [ ] Review the migration and preserve a recoverable database backup through your existing Supabase backup process. Keep public signups disabled during migration/import. The preflight intentionally aborts if the reviewed cohort, distributor, empty Auth table or schema has changed. Do not edit around a failed preflight; inspect the difference.
2. [ ] In [this project's SQL Editor](https://supabase.com/dashboard/project/vzcffpmuxlvqgjdsfuwb/sql/new), run the complete contents of `backend/sql/auth_supabase_migration.sql` once. Expected: transaction succeeds, 12 legacy profiles remain active, no Auth accounts yet, all business tables have RLS. This is an additive data-preserving migration; it does not clear tables. Existing delivery/POD migrations remain separate release prerequisites; do not rerun the initial schema or reset-data script.
3. [ ] From repository root run `node backend/scripts/import_legacy_auth.js`. Expected: 12 safe “would import” entries. This dry-run never reads hashes or creates Auth accounts. It requires migration step 2 first and reads the existing ignored `backend/.env`.
4. [ ] From repository root, after reviewing the dry-run, run `node backend/scripts/import_legacy_auth.js --apply`. Expected: 12 same-ID Auth imports or already-linked entries. This is an explicit server-only credential transfer; **it creates Auth identities but never recreates application profiles**. It uses the supported admin hash import with `phone_confirm: true` for the authorized grandfathered cohort, so no SMS is sent. That Auth confirmation is administrative trust, not evidence of previous OTP; application `phone_verified_at` remains unset. If interrupted, rerun safely; do not delete partial imports. Existing bcrypt password values are transferred only in server memory and are not printed.
5. [ ] Configure **Authentication -> Sign In / Providers -> Phone** in the same project: enable phone sign-in; require phone confirmation (automatic phone confirmation OFF); set OTP length to 6, OTP expiry to 300 seconds, and resend minimum interval to at least 60 seconds. Set the Auth password minimum to at least 8 characters. Keep signups off until the backend/hook are ready. Do not populate fake Twilio credentials or select Twilio Verify to bypass configuration; the Send SMS Hook replaces delivery. Disable unused public identity providers if this project is exclusively the phone-based app.
6. [ ] Deploy the existing Node backend to its current host. Its configured public URL is `https://capstone-veggietrack.onrender.com`. On the host use root directory `backend`, build command `npm ci --no-audit --no-fund`, start command `npm start`. Expected: Node service healthy; `GET /` responds; protected APIs require Supabase sessions. Local equivalent: directory `...\Capstone_VeggieTrack\backend`, command `npm.cmd start`. No new Edge Function is needed: the existing Express server is the secure hook handler.
7. [ ] Store the server secrets described below in that host's private environment settings. Keep `PHILSMS_DELIVERY_ENABLED=false` until ready for the first intentional paid test. Local development values belong in ignored `backend/.env` only. Redeploy/restart after changing environment variables.
8. [ ] In **Authentication -> Hooks -> Send SMS**, select an HTTP hook with URL `https://capstone-veggietrack.onrender.com/api/hooks/send-sms`. Generate the signing secret there and store it as backend `SEND_SMS_HOOK_SECRET` (the complete `v1,whsec_...` value is accepted). Ensure the backend is running and reachable within Supabase's HTTP hook timeout; a sleeping host may fail SMS requests. Expected response from an accepted hook is HTTP 200 with `{}`. Unsigned requests must fail and cannot send SMS. Do not test by supplying a real OTP payload yourself.
9. [ ] In your EAS/build environment set **public** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and the existing `BACKEND_URL`. Local mobile values are already configured. From `...\Capstone_VeggieTrack\mobile`, run `npm.cmd start` to open Expo. Expected: phone/password login and Create account screens. Follow the existing `mobile/EAS_BUILD.md` for signed native release builds.
10. [ ] Validate existing-account phone/password login, role dashboards and history after import, including the distributor. No OTP or reapproval should be needed. Coordinate backend/mobile cutover; the previous local authentication was paused, so this cannot promise uninterrupted service from that checkpoint. Do not release only the new mobile build before its backend/database are ready.
11. [ ] After successful import/login validation, run `backend/sql/auth_finalize_credentials.sql` in the project's SQL Editor. Expected: obsolete application password/reset-token columns removed only after all 12 Auth links pass its preflight. This is the separate, intentionally manual credential cleanup; no profile or transaction is deleted. Keep any backup containing legacy hashes private. Do not use the original inspection SQL after this cleanup because it references the removed column.
12. [ ] Verify PhilSMS sender approval/balance, set `PHILSMS_DELIVERY_ENABLED=true` only when ready, restart the server, enable public signups, and perform the manual tests below.

## PhilSMS: required private configuration

Log in at [app.philsms.com](https://app.philsms.com). The [official API documentation](https://app.philsms.com/developers/documentation) points to the signed-in dashboard for the API token.

| Setting | Obtain/store |
|---|---|
| `PHILSMS_API_TOKEN` | `<USER MUST PROVIDE>`: obtain your account's API token from the PhilSMS dashboard/API area; store in backend host private environment |
| `PHILSMS_SENDER_ID` | `<USER MUST PROVIDE>`: select a sender approved for your account from its Sender ID area; confirm with PhilSMS support if the area/approval is unclear; store the exact value in backend private environment |
| `SEND_SMS_HOOK_SECRET` | `<USER MUST PROVIDE>`: generate in Supabase Send SMS Hook settings; store in backend private environment |
| `PHILSMS_DELIVERY_ENABLED` | `false` until manual testing; deliberately change to `true` to allow actual delivery |

No sender name is hardcoded; `VeggieTrack` is not assumed approved. The documented alphanumeric maximum is 11 characters. Destination format is `639XXXXXXXXX`, while app identity inputs use `+639XXXXXXXXX`. Check available SMS units/balance in the signed-in PhilSMS dashboard before testing. This session had no PhilSMS account access: exact account-specific menu labels, approved senders, balance and carrier restrictions could not be inspected. Confirm sender routing/availability for your recipient carrier with PhilSMS before first use. Nothing was purchased or registered.

The handler checks both HTTP success and JSON `status: "success"`; this means the provider accepted the SMS, not proof that the handset received it. API credentials, invalid sender, insufficient credits and provider errors all fail the hook. Current Supabase Auth supplies `sms.phone`; an older ambiguous pending-phone payload is rejected rather than risking sending a change OTP to the old number.

## First live acceptance tests — user runs these

**This step may consume PhilSMS SMS credits.** Never run it as an automated build/test.

1. Register a new Farmer/Rider/Retailer with a phone you control. Receive OTP, verify, and confirm the exact pending-approval message. Confirm the dashboard remains blocked.
2. Sign in as distributor -> people icon / User Management -> Pending Approval -> approve. Refresh applicant status -> correct dashboard. Log out/in with the same phone/password: no OTP or reapproval.
3. On an active account: Edit Profile -> Change Number -> new number you control -> review -> Send Verification Code. Before verification, confirm the current profile phone remains old. An incorrect code must leave it unchanged. Verify the correct code -> same profile ID, role, approval and history, updated phone. Log out and log in with new phone/existing password; old phone must cease to be the current login identity.
4. Decline a separate pending request with a reason and verify blocked status. Disable a rider with unfinished work: old session loses business access and distributor sees preserved assignments. Reactivate: old session remains blocked; fresh login succeeds.

## Validation and limits

Local tests exercise Standard Webhooks signatures, mocked PhilSMS failures/success, PH normalization, phone-change errors, server status guards, legacy import retries, PostgreSQL migration/security/audit/assignment behavior and existing business regressions. Expo web/Android/iOS export checks JavaScript and Hermes compilation; it is not a signed native installation or hosted Auth integration test.

No lint/typecheck scripts are defined in the active packages. Expo compatibility checking still reports the nine previously recorded patch mismatches (Expo, dev-client, font, image-picker, location, print, secure-store, sharing, sqlite); unrelated upgrades were not made. Real device flow, hosted migration/import behavior, provider configuration and actual SMS receipt remain manual deployment verification.

Primary references: [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook), [current Auth SMS payload](https://github.com/supabase/auth/blob/master/internal/hooks/v0hooks/v0hooks.go), [phone/password authentication](https://supabase.com/docs/guides/auth/passwords), [admin user creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [phone updates](https://supabase.com/docs/reference/javascript/auth-updateuser), [OTP verification](https://supabase.com/docs/reference/javascript/auth-verifyotp).
