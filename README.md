Last reviewed: 2026-09-20

# VeggieTrack

VeggieTrack connects farmers, a distributor, retailers and riders through an Expo/React Native app, Express API, Supabase Postgres/Auth, Cloudinary, and Leaflet/OSRM maps. The main app is `mobile/`; `VeggieTrack-Clean/` is a separate starter project excluded from EAS uploads.

The hosted database is migrated for every table and RPC the API calls, and the hosted API is live. Physical-device acceptance remains pending. See [STATUS_REPORT.md](STATUS_REPORT.md) for verification results and release prerequisites.

## Repository layout

| Path | Purpose |
|---|---|
| `mobile/` | Main Expo application for all four business roles |
| `mobile/src/components/` and `mobile/src/theme/` | Shared screen headers, status UI, navigation and redesign tokens |
| `mobile/src/i18n/` | English/Tagalog string tables and the language provider |
| `mobile/src/offline/` and `mobile/src/sync/` | Harvest cache/queue and the app-wide revalidation coordinator |
| `backend/index.js`, `backend/lib/` | Express API, authorization and business logic |
| `backend/sql/` | Inspections, guarded migrations and historical schema scripts |
| `backend/scripts/` | Read-only hosted inspections and one-off maintenance utilities |
| `backend/test/` | Node regression tests, mobile handler tests and local PGlite integration tests |
| `docs/` | Low-fidelity screen wireframes and their screen-by-screen descriptions; the module and data-flow diagrams are generated locally and not committed |
| `design-prototype/` | Standalone click-through visual prototype using fictional sample data |
| `VeggieTrack-Clean/` | Separate Expo starter; not the business application |

## Workflows

- **Farmer:** record harvests with photos, edit or delete them, request pickups, follow an assigned pickup on a live map, browse history, and export a weekly harvest report as a PDF. Harvests are cached and queued while offline, then replayed on reconnect.
- **Distributor:** assign pickup requests to riders, receive traceable inventory batches under FIFO stock rules, attach batch photos, list vegetables and set prices, approve or reject orders, assign riders to deliveries, record payments, review the inventory and weekly reports with history and PDF export, and move accounts between `unverified`, `pending_approval`, `active`, `declined` and `disabled` through a version-checked RPC that records an audit trail.
  - Payment Recording: Payment is recorded as an internal status by the distributor; no external payment processor is integrated.
- **Retailer:** browse listed stock, build a cart, order at least 5 kg in total, save delivery pins (map pinning plus optional place search), choose a future delivery schedule, confirm the order, track delivery on a map, and review order details and history. A retailer or the distributor can cancel an order while it is still `pending` — the distributor must give a reason — and the reserved stock is restored to its batches under an atomic guard so a duplicate cancel cannot restore it twice. Separately, a pending, approved or assigned order whose preferred schedule has already passed is cancelled automatically on the next order read or write.
- **Rider:** two legs. Farm pickups — accept an assigned pickup request, optionally mark on-the-way, then complete it with a mandatory photo and fresh GPS proof. Retailer deliveries — travel to the warehouse, mark picked up/in transit, navigate to the order destination and submit proof, or reject the assignment with a required reason that hands it back to the distributor.
- **Shared:** profile photos, messages, notifications, saved delivery addresses, account approval, email/password authentication, email confirmation, email sign-in codes, password-reset links, English/Tagalog switching, an in-app user guide and a Contact Us screen.

Account maintenance: **Change password** on Edit Profile sends the same emailed reset link as "Forgot password". There is no in-app password-change endpoint — `PUT /api/users/:id/password` deliberately answers `410`. Accounts are never deleted; `DELETE /api/users/:id` answers `409` and directs the user to ask the distributor to disable the account so transaction history is preserved.

## Language and in-app help

The app ships English (`en`) and Tagalog (`tl`) string tables. The switcher is on the Profile screen and the farmer's profile tab; the choice is persisted with AsyncStorage and restored on launch. A missing key falls back to English and then to the key itself, so an untranslated string never crashes the UI.

Coverage is partial. Most role screens are translated; the authentication screens (Login, Forgot password, Reset password, Verify email), Account Management, Application Status, the order and pickup tracking screens and the customer tracking view are still English-only.

The Profile screen also opens a **User Guide** modal with per-role steps and an FAQ, both translated, and a **Contact Us** modal showing hub address, phone, email and hours. The Contact Us inquiry form is presentation only — it validates input and shows a success message, but does not send the message anywhere.

## Asynchronous screen updates

The app uses React state and authenticated asynchronous API requests. Updated lists refresh on return while preserving screen selections, and stale responses are ignored. Synchronous request locks protect the updated forms from repeated taps before buttons rerender. Failed operations retain relevant form input or previously loaded data for retry.

A single `SyncProvider` owns app-wide freshness: screens register role-specific readers instead of creating their own listeners or timers. It revalidates on a 30-second timer, on reconnect and on foreground, coalescing overlapping passes into one, and replays the offline harvest queue on reconnect. An offline banner reports connectivity, and an error boundary wraps the navigator.

The latest updates cover harvests, pickups, inventory, checkout, orders, addresses, profiles, messages and notifications. Farmer offline queue operations are serialized to prevent concurrent replay. Rider pickup cards render across dashboard sections, and order details refresh from the API instead of relying only on navigation snapshots. These UI changes require no additional database migration. See [AJAX_IMPLEMENTATION_REPORT.md](AJAX_IMPLEMENTATION_REPORT.md) for screen-level coverage and limitations.

Messages and notifications are polled, not realtime: the notification bell every 30 seconds, the message contact list every 5 seconds, and an open thread every 3 seconds. No Supabase Realtime subscription or push notification is wired up.

The current mobile redesign is applied through shared theme tokens and reusable UI components, including the cream surfaces, leaf-green actions, semantic status colors, rounded controls and elevated bottom navigation used across all roles. The implementation review is recorded in [DESIGN_INTEGRATION_REVIEW.md](DESIGN_INTEGRATION_REVIEW.md). The standalone [design prototype](design-prototype/README.md) is for visual review only; it is not connected to the API, Supabase or the production app, and its proposed states are not production functionality.

## Delivery, GPS and proof

The backend resolves the destination consistently for tracking and completion: order coordinate snapshot, then one unambiguous matching saved address pin, then a matching store pin. It rejects missing or ambiguous coordinates instead of guessing.

| Policy | Value |
|---|---|
| `STALE_LOCATION_SECONDS` | 60 s |
| `MAX_ACCEPTABLE_GPS_ACCURACY_METERS` | 100 m |

Distance is Haversine/geodesic, never road distance. The effective radius (`100 + min(accuracy, 50)` meters) is retained only to label a submitted proof as `verified` or `unverified`; it is no longer a completion fence. Accuracy above 100 m and GPS samples older than 60 seconds are rejected. The phone requests multiple fresh high-accuracy fixes during a bounded 10-second refinement period and uses the most accurate acceptable sample. Permission/services checks have a separate bounded deadline. Known mocked fixes are rejected. The delivery screen offers **Refresh Location**, distance and accuracy diagnostics.

The flow is: open delivery -> refine GPS -> capture/select proof -> submit -> verify fresh GPS metadata -> server pre-flight -> upload to Cloudinary -> refresh GPS after the upload -> backend and PostgreSQL validate -> atomically save proof and delivered statuses -> confirm in the UI. A failed attempt retains the photo; a backend retry reuses its successful upload. Only explicit backend confirmation completes the UI. Duplicate taps share one operation; status changes cannot overlap submission on the screen.

Farm pickups use the same capture pipeline and the same mandatory photo, accuracy and timestamp rules, completed through `complete_pickup_with_proof`, which additionally checks proximity to the farmer's saved location when one exists.

The pre-flight step exists because an image uploaded for a completion the server then rejects is orphaned in Cloudinary with nothing referencing it. `POST /api/deliveries/:id/complete/check` and `POST /api/pickup-requests/:id/pickup/check` run the assignment, status, destination and GPS checks the real completion runs — everything except the photo — and write nothing. The pickup check also mirrors the 150 m proximity rule that `complete_pickup_with_proof` enforces, so a rider standing too far from the farm is told to move closer before spending an upload. Those endpoints are advisory: both completion routes re-run the same guards (`backend/lib/proofGuards.js`), and the SQL functions remain the authority. The phone skips the pre-flight on a retry whose photo is already hosted, and a backend that does not serve these routes yet never blocks a completion it would have accepted.

Cloudinary uploads and API fetches have 30-second timeouts. Upload configuration, file preparation, upload rejection, real offline, unreachable API, expired session, backend rejection and server failure have distinct handling. Only NetInfo reporting offline produces the offline message. Authentication tokens come from the current Supabase session, never a bundled service credential.

## Live tracking and ETA

There is one **LIVE ETA** for the current leg: rider to warehouse before pickup; rider to destination after pickup. It uses the current OSRM route duration, rounded to whole minutes/hours. A retained static warehouse route is not a live ETA. Missing routing or stale GPS displays **ETA unavailable**; GPS publishing remains independent of routing.

Routes refresh on target change, missing route, 50 m movement, 30-second active-route age, or more than 75 m off-route displacement. Static corridor cache age is five minutes; routing failures are cached for 15 seconds. Backend routing is serialized/deduplicated. GPS writes use capture timestamps; polling aborts on cleanup and guards late responses. Tracking runs while the rider navigation screen is focused and the app is active. Locked-phone/background tracking, offline navigation, voice guidance and live traffic are not implemented.

## Setup and configuration

Install locked dependencies with `npm ci --prefix backend` and `npm ci --prefix mobile`. Copy each `.env.example` to its ignored `.env`, then configure the appropriate variables. Never commit `.env`.

Mobile variables: `BACKEND_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Optional: `IOS_BUNDLE_IDENTIFIER`, and `EXPO_PUBLIC_GEOAPIFY_API_KEY` for address autocomplete — leave it blank and address entry falls back to manual map pinning only. That key is client-visible by design and must also be set in the EAS environment of the build profile you use. The Cloudinary preset must allow unsigned image uploads. A device needs a reachable backend URL; localhost refers to the phone itself.

For the email-only account flow, enable Email/password and email confirmation in Supabase Auth. Add `veggietrack://reset-password` to Supabase Auth's allowed redirect URLs before shipping a native build; the reset email opens this deep link and exchanges its one-time PKCE code in the app. Production email confirmation, sign-in-code and reset flows need a configured SMTP provider because Supabase's default mail service is rate-limited. The sign-in code is an application UI challenge after password validation; it is not server-enforced MFA or a higher Supabase AAL claim.

Backend variables: `PORT`, `NODE_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `CLOUDINARY_CLOUD_NAME`. Optional mapping/diagnostics: `OSRM_BASE_URL`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `MAPS_USER_AGENT`, `DEBUG_DELIVERY_LOCATION`.

Babel's `react-native-dotenv` allowlist inlines only the three upload/API variables (`BACKEND_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`) from local dotenv or the EAS process environment. Everything prefixed `EXPO_PUBLIC_` — the Supabase configuration and the Geoapify key — is read through Expo's own public-variable mechanism instead. The development, preview and production EAS profiles explicitly select matching environments; the preview profile builds an installable Android APK. Never put service-role keys or Cloudinary secrets in mobile. See [EAS build notes](mobile/EAS_BUILD.md).

## Database and deployment

The September 19 read-only hosted inspection found the destination snapshot columns, rider accuracy, POD column, avatar columns and the completion/status/account RPCs all **present**. The delivery and email-only Auth rollouts are already applied; the September 16 inspection recorded in [DELIVERY_RELIABILITY_REPORT.md](DELIVERY_RELIABILITY_REPORT.md) predates them. Do not reapply `delivery_location_policy.sql`, `delivery_proof_relax_radius_migration.sql`, `email_otp_verification_migration.sql` or `email_only_auth_migration.sql`, and never reapply the historical proof function — that would restore its old radius policy.

[delivery_reject.sql](backend/sql/delivery_reject.sql) has also been applied: the September 20 read-only inspection found `deliveries.rejection_reason` and `deliveries.rejected_at` both **present**, so a rider's rejection reason is stored.

[fix_account_rpcs_email_only.sql](backend/sql/fix_account_rpcs_email_only.sql) was applied on September 20 and is the correction to the note above: `auth_email_password_migration.sql` had never been applied, so `vt_admin_transition`, `vt_account_context` and `vt_active_participant` were still the SMS-era versions. `vt_admin_transition` compared the acting distributor against the pre-migration seed UUID `0a417507-1437-4d71-9e11-185f13a0a262` instead of the live `86d9d317-b099-430c-be21-824d0a3434b6`, so **every** account approval failed with "Distributor authorization required", and the surviving phone gate would have refused an approved email-only user on every API call. Do not apply `auth_email_password_migration.sql` itself — its `vt_sync_auth` predates the email-OTP gate and would let registrations skip email confirmation. No migration is currently outstanding.

Re-verify the hosted contract at any time with the read-only scripts in `backend/scripts/` — they issue GETs against the Supabase REST introspection endpoint and never write or read row data.

Two destructive scripts are **not** migrations. `reset_data.sql` truncates `users`, which removes the trusted distributor that `backend/lib/auth.js` hardcodes. `reset_test_data_keep_distributor.sql` is the newer handover script: it clears all business data and every account except that distributor, ready for real client accounts. Both are irreversible — take a database backup first, and note that neither clears uploaded media in Cloudinary.

The older `schema_complete.sql` and incremental inventory scripts are historical setup sources, not a complete universal installer for the current hosted schema. In particular, saved-address/tracking tables and some hosted runtime columns originated outside that base file.

## Run and verify

```powershell
npm.cmd run dev --prefix backend
npm.cmd start --prefix mobile
npm.cmd test --prefix backend
node --check backend/index.js
Get-ChildItem backend/lib -Filter *.js | ForEach-Object { node --check $_.FullName }
cd mobile
npx.cmd --no-install expo export --platform web --output-dir .expo/delivery-verification/web
```

The test suite includes Auth/security, avatars, checkout, cross-role inventory handoff, POD/upload retry, GPS/radius, ETA and local PostgreSQL/PGlite migration checks. PGlite tests run serially to remain within Node's memory limit. Main mobile has no configured lint/typecheck script. A successful web export does not validate a native release or real GPS/camera/provider setup. See [delivery verification report](DELIVERY_RELIABILITY_REPORT.md) for results, remaining deployment work and a rider-phone test script.

The asynchronous UI report also records successful Web, Android and iOS/Hermes production bundles. These are bundle checks, not signed release builds or hosted end-to-end acceptance. For optional starter-only checks, run `npm.cmd run lint --prefix VeggieTrack-Clean`, then run `npx.cmd --no-install tsc --noEmit` from `VeggieTrack-Clean/`.

## Related documentation

- [Current project status](STATUS_REPORT.md)
- [Asynchronous UI changes and verification](AJAX_IMPLEMENTATION_REPORT.md)
- [Delivery reliability, guarded SQL and manual rider tests](DELIVERY_RELIABILITY_REPORT.md)
- [Profile photo implementation and hosted verification limits](CHUNK1_AVATARS_REPORT.md)
- [EAS build and environment setup](mobile/EAS_BUILD.md)
- [Low-fidelity screen wireframes](docs/wireframes.html)
