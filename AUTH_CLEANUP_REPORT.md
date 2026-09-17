Last reviewed: 2026-09-16

## Historical checkpoint

The cleanup report below describes an earlier checkpoint, not current authentication behavior. Supabase Auth is implemented; follow [AUTH_SUPABASE_SETUP.md](AUTH_SUPABASE_SETUP.md). The current delivery/GPS/POD/ETA changes and verification are in [DELIVERY_RELIABILITY_REPORT.md](DELIVERY_RELIABILITY_REPORT.md). No authentication rules or security tests were removed by that task.

# Authentication cleanup report

Date: September 15, 2026

## Result and scope

Removed the abandoned Firebase phone-auth implementation. Supabase database access and unrelated delivery, checkout, tracking, proof-of-delivery, profile, and offline code remain. Authentication is deliberately paused: this is a preparation checkpoint, not a functioning Supabase Auth release. PhilSMS was not implemented, no SMS credentials were requested or added, and no live database or deployment was changed.

## Inspection and provenance

Inspected repository inventory, Git status/diffs/history, manifests and locks, backend route/auth boundaries, Supabase/schema configuration, mobile navigation/API/context/auth/profile screens, environment key names, Expo/EAS/Android configuration, tests and prior audit/setup documents. Searched hidden and ignored files as well as application source; excluded Git's internal object storage from text searches.

- `backend/`: CommonJS Express 5 API; server-side Supabase JS client uses `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Business data lives in PostgreSQL. Cloudinary handles application images.
- `mobile/`: Expo 57, React Native 0.86.3, React Navigation, JavaScript; native/web API calls go to Express. SecureStore/localStorage previously held custom application tokens; SQLite supports offline business data. Maps use Leaflet/OSRM and Expo Location.
- `VeggieTrack-Clean/`: separate Expo Router/TypeScript starter, excluded from EAS uploads; no application Firebase integration found. Left unchanged.
- Firebase integration files were untracked, and its changes to tracked files were uncommitted. `git grep -i firebase HEAD` found no committed Firebase references. The prior audit identifies its exact file list and says its migration was not applied. This distinguishes the abandoned work from the existing delivery/POD changes. There is no separate Firebase commit to revert.
- Read the mobile instruction's required [Expo v56 reference](https://docs.expo.dev/versions/v56.0.0/); retained the repository's installed SDK rather than changing versions.

## 1. Files removed

- `backend/lib/firebaseAuth.js`
- `backend/test/firebaseAuth.test.js`
- `backend/test/firebaseAuthSql.test.js`
- `backend/test/firebaseClient.test.js`
- `backend/sql/firebase_auth_migration.sql`
- `mobile/src/lib/firebaseErrors.js`
- `mobile/src/lib/firebasePhone.native.js`
- `mobile/src/lib/firebasePhone.web.js`
- `FIREBASE_AUTH_SETUP.md`
- `FIREBASE_AUTH_AUDIT.md`

The removed SQL file was the newly added, reportedly unapplied provider-specific linking migration. No existing business migration, RLS policy, table, stored data, or live SQL object was removed. Generated `mobile/auth-check-export*` directories were removed after validation so old auth bundles cannot be mistaken for current deliverables.

## 2. Code removed

Removed native/browser initialization, reCAPTCHA, SMS send/confirm/resend and automatic-verification listeners, phone-change SDK calls, Firebase ID-token exchange and refresh, Admin SDK verification/current-user lookup, service-account loading, UID/profile linking RPC calls, and custom application JWT issuance/verification. Removed the phone-availability endpoint that depended on the abandoned migration.

Kept business route authorization placement and existing role/ownership checks. `backend/lib/auth.js` is an explicit temporary rejecting guard, not a replacement authentication system. Updated `authRoutes.test.js` and added `authClient.test.js` to test the transition boundary and client error handling.

## 3. Dependencies

Removed with npm uninstall, updating both lockfiles normally:

- Backend: `firebase-admin`, and now-unused `jsonwebtoken`.
- Mobile: `firebase`, `@react-native-firebase/app`, `@react-native-firebase/auth`, and `expo-build-properties` (added solely for the provider's iOS framework configuration).

Preserved `@supabase/supabase-js`, PGlite (still used by delivery SQL tests), Expo dev-client, Google fonts, location/media packages, and unrelated dependencies. No package version upgrade was requested or performed.

## 4. Environment configuration

Removed from examples: `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`, `FIREBASE_ANDROID_CONFIG`, and `FIREBASE_IOS_CONFIG`. Removed the obsolete custom `JWT_SECRET` example.

Local `.env` files contained no Firebase keys. They were left unchanged; an existing backend `JWT_SECRET` is now unused. Existing Supabase, backend URL, and Cloudinary variables remain. No client config JSON/plist or service-account file was found in the active checkout outside dependency/worktree caches. No secret values were printed.

## 5. Android and Expo

Removed the Google Services Gradle classpath/plugin and EAS client-file copy block. Removed dynamic config's client-file paths, native Firebase plugins, iOS push entitlement/background modes, and provider-only framework configuration. Retained optional `IOS_BUNDLE_IDENTIFIER`, package `veggietrack.com`, EAS project settings, and all existing location, image-picker, font, sharing, storage, and delivery permissions in `app.json`.

## 6. Supabase preserved and future integration

The existing server client and database operations remain. `SUPABASE_ANON_KEY` exists in backend configuration but is not currently used by an Auth client; there is no active mobile Supabase client or working Supabase sign-in/session flow. Supabase Auth is available through the installed backend SDK but is not connected to the UI or API guard.

Later work must connect SDK-managed OTP/session lifecycle, validate Supabase access tokens on Express, and map `auth.users` identities to existing `public.users.id` without breaking foreign keys. Existing users have required legacy `password_hash` fields; future registration needs a reviewed migration rather than invented passwords. Preserve account UUIDs and review RLS/profile provisioning when implementing that work.

The intended later flow is mobile -> Supabase Auth -> Send SMS Hook -> server-side PhilSMS delivery; the code returns to Supabase Auth for verification/session creation. SMS credentials belong only in server-side secrets. This report does not implement any of those steps.

## 7–8. Current UI and authentication behavior

| File or route | Current behavior / later work |
| --- | --- |
| `LandingScreen.js` | Existing navigation retained. |
| `LoginScreen.js`, `ForgotPasswordScreen.js` | Both already re-exported `PhoneOtpScreen`; now show unavailable state. Connect login/recovery to Supabase later. |
| `PhoneOtpScreen.js` | Existing styling/phone form retained, SMS action disabled with English/Tagalog notice. Reconnect send/verify/resend to Supabase later. |
| `RegisterScreen.js` (`CompleteProfile`) | Name, role, location, and map-pin form retained; submit disabled. Later provision a profile only for a verified Supabase user. |
| `ChangePhoneScreen.js` | Phone form retained with disabled action and unavailable notice. Later use Supabase's verified phone-change lifecycle. |
| `EditProfileScreen.js` | Existing profile editing/deletion code and navigation retained; inaccessible online while auth is paused. Review future phone-change integration. |
| `App.js` | Existing route names retained; `Register` still points to the shared phone screen. |
| `AuthContext.js` | Removes saved application token/user on startup, does not restore old dashboards, preserves queued offline data during that retirement. Supabase session subscription/persistence remains future work. |
| `api/client.js` | No provider token refresh or custom exchange; handles unauthorized and transient errors. Later attach SDK-managed Supabase access tokens. |
| `/api/auth/*` | No exchange/login/register handlers; returns 503, except protected `/me` which returns 401. |
| Protected business APIs | Reject all credentials with 401, including old tokens. No unauthenticated fallback. Public health/product routes remain. |

Authentication-dependent screens are temporarily non-functional. UI components and business handlers being retained does not mean those protected workflows are usable at this checkpoint.

## 9–10. Checks and results

| Check | Result |
| --- | --- |
| npm uninstall and normal lock updates | Passed |
| `npm ci --no-audit --no-fund` in backend and mobile | Passed; mobile retried with approved access after Windows EPERM |
| `npm ls --depth=0` in both packages | Passed |
| `node --check backend/index.js` and `backend/lib/auth.js` | Passed |
| `npm test --prefix backend` | 59 passed, 0 failed; includes SQL, checkout, delivery/POD, auth boundaries and all mobile source compilation |
| `expo config --type public --json` | Passed; resolved config has no provider plugins/files or push entitlement |
| `expo export --platform all` | Web, Android and iOS/Hermes passed after approved compiler access |
| `git diff --check` | Passed; Git line-ending notices only |
| `expo install --check` | Failed on nine previously documented patch mismatches; no unrelated upgrade made |

Expo installed -> expected: expo 57.0.20 -> ~57.0.22; dev-client 57.0.18 -> ~57.0.19; font 57.0.3 -> ~57.0.4; image-picker/location 57.0.16 -> ~57.0.17; print 57.0.1 -> ~57.0.2; secure-store 57.0.3 -> ~57.0.4; sharing 57.0.18 -> ~57.0.19; sqlite 57.0.2 -> ~57.0.3.

Existing Node module-type and deprecated-package warnings remain. No lint/typecheck scripts are defined for active mobile/backend packages; mobile JS compilation is covered by tests. The untouched starter's lint/TypeScript checks were not run. Native Gradle/Xcode builds, signing, device interaction, live Supabase and SMS were not tested. Bundle exports do not establish a successful native release build.

## 11. Remaining references reviewed

No Firebase integration remains in application source, manifests, lockfiles, environment examples, or active Expo/Gradle configuration. Remaining textual references have these purposes:

- This report documents the removal.
- `.gitignore` still excludes `*firebase-adminsdk*.json`, `google-services.json`, and Apple/service-account credential files. Keeping these protective rules prevents accidentally committing old credentials; they enable no integration.
- Installed dependencies contain generic Expo Google Services support/types/examples, icon names, debugger/Lighthouse catalog data, Supabase compatibility comments/keywords, date-fns release documentation and Keyv adapter documentation. These are upstream package contents, not configured app authentication.
- Existing Android generated manifests/logs reference Google ML Kit barcode/common components using the `com.google.firebase.components` namespace. These are unrelated Google components, not the abandoned phone-auth SDK. Existing generated web bundles/source maps also contain icon names. They were not edited as application source.
- `.claude/worktrees` and the separate starter contain the same upstream dependency references. No active first-party auth integration was found there; independent worktrees were left intact.

The post-cleanup search included case-insensitive `firebase`, `google-services`, and `GOOGLE_APPLICATION_CREDENTIALS` across hidden/ignored checkout files, including dependency/build folders. Git history was inspected separately and not rewritten.

## 12. Decisions and input

No further input is needed to finish this cleanup. Before the next auth implementation, verify the deployed database state: the previous audit reported the removed migration unapplied, but no remote inspection was performed here. If someone applied it separately, its live UID/linking objects and permissions need a reviewed follow-up migration; do not drop them blindly. Supabase account mapping, RLS and new-profile schema work remain for the next authorized task. Authentication stays paused until that integration is implemented. No PhilSMS implementation or deployment was started.
