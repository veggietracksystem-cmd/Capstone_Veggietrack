Last reviewed: 2026-09-16

# VeggieTrack

VeggieTrack connects farmers, a distributor, retailers and riders through an Expo/React Native app, Express API, Supabase Postgres/Auth, Cloudinary, and Leaflet/OSRM maps. The main app is `mobile/`; `VeggieTrack-Clean/` is a separate starter project excluded from EAS uploads.

Local implementation is available, but hosted delivery migration, deployment and physical-device acceptance remain pending according to the latest recorded inspection. See [STATUS_REPORT.md](STATUS_REPORT.md) for verification results and release prerequisites.

## Repository layout

| Path | Purpose |
|---|---|
| `mobile/` | Main Expo application for all four business roles |
| `mobile/src/components/` and `mobile/src/theme/` | Shared screen headers, status UI, navigation and redesign tokens |
| `backend/index.js`, `backend/lib/` | Express API, authorization and business logic |
| `backend/sql/` | Inspections, guarded migrations and historical schema scripts |
| `backend/test/` | Node regression tests, mobile handler tests and local PGlite integration tests |
| `design-prototype/` | Standalone click-through visual prototype using fictional sample data |
| `VeggieTrack-Clean/` | Separate Expo starter; not the business application |

## Workflows

- Farmer: record harvests, request pickups, view history and export reports. Existing offline harvest caching/queues remain.
- Distributor: assign pickups, receive traceable inventory batches, list vegetables, approve orders, assign riders, record payments and inspect reports.
- Retailer: browse listed stock, order at least 5 kg, save a delivery pin and future schedule, and track delivery.
- Rider: follow the assigned delivery to the warehouse, mark picked up/in transit, then navigate to the order destination and submit proof.
- Shared: profile photos, messages, notifications, account approval, Supabase phone/password authentication and verified phone changes.

## Asynchronous screen updates

The app uses React state and authenticated asynchronous API requests. Updated lists refresh on return while preserving screen selections, and stale responses are ignored. Synchronous request locks protect the updated forms from repeated taps before buttons rerender. Failed operations retain relevant form input or previously loaded data for retry.

The latest updates cover harvests, pickups, inventory, checkout, orders, addresses, profiles, messages and notifications. Farmer offline queue operations are serialized to prevent concurrent replay. Rider pickup cards render across dashboard sections, and order details refresh from the API instead of relying only on navigation snapshots. These UI changes require no additional database migration. See [AJAX_IMPLEMENTATION_REPORT.md](AJAX_IMPLEMENTATION_REPORT.md) for screen-level coverage and limitations.

The current mobile redesign is applied through shared theme tokens and reusable UI components, including the cream surfaces, leaf-green actions, semantic status colors, rounded controls and elevated bottom navigation used across all roles. The implementation review is recorded in [DESIGN_INTEGRATION_REVIEW.md](DESIGN_INTEGRATION_REVIEW.md). The standalone [design prototype](design-prototype/README.md) is for visual review only; it is not connected to the API, Supabase or the production app, and its proposed states are not production functionality.

## Delivery, GPS and proof

The backend resolves the destination consistently for tracking and completion: order coordinate snapshot, then one unambiguous matching saved address pin, then a matching store pin. It rejects missing or ambiguous coordinates instead of guessing.

| Policy | Value |
|---|---|
| `BASE_DELIVERY_RADIUS_METERS` | 100 m |
| `MAX_ACCURACY_ALLOWANCE_METERS` | 50 m |
| `STALE_LOCATION_SECONDS` | 60 s |
| `MAX_ACCEPTABLE_GPS_ACCURACY_METERS` | 100 m |

The effective radius is `100 + min(accuracy, 50)` meters. Distance is Haversine/geodesic, never road distance. Accuracy above 100 m cannot widen the fence. The phone requests multiple fresh high-accuracy fixes during a bounded 10-second refinement period and uses the most accurate acceptable sample. Permission/services checks have a separate bounded deadline. Known mocked fixes are rejected. The delivery screen offers **Refresh Location**, distance and accuracy diagnostics.

The flow is: open delivery -> refine GPS -> verify the actual destination and effective radius -> capture/select proof -> submit -> verify again -> upload to Cloudinary -> refresh GPS after the upload -> backend and PostgreSQL validate -> atomically save proof and delivered statuses -> confirm in the UI. A failed attempt retains the photo; a backend retry reuses its successful upload. Only explicit backend confirmation completes the UI. Duplicate taps share one operation; status changes cannot overlap submission on the screen.

Cloudinary uploads and API fetches have 30-second timeouts. Upload configuration, file preparation, upload rejection, real offline, unreachable API, expired session, backend rejection and server failure have distinct handling. Only NetInfo reporting offline produces the offline message. Authentication tokens come from the current Supabase session, never a bundled service credential.

## Live tracking and ETA

There is one **LIVE ETA** for the current leg: rider to warehouse before pickup; rider to destination after pickup. It uses the current OSRM route duration, rounded to whole minutes/hours. A retained static warehouse route is not a live ETA. Missing routing or stale GPS displays **ETA unavailable**; GPS publishing remains independent of routing.

Routes refresh on target change, missing route, 50 m movement, 30-second active-route age, or more than 75 m off-route displacement. Static corridor cache age is five minutes; routing failures are cached for 15 seconds. Backend routing is serialized/deduplicated. GPS writes use capture timestamps; polling aborts on cleanup and guards late responses. Tracking runs while the rider navigation screen is focused and the app is active. Locked-phone/background tracking, offline navigation, voice guidance and live traffic are not implemented.

## Setup and configuration

Install locked dependencies with `npm ci --prefix backend` and `npm ci --prefix mobile`. Copy each `.env.example` to its ignored `.env`, then configure the appropriate variables. Never commit `.env`.

Mobile variables: `BACKEND_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Optional: `IOS_BUNDLE_IDENTIFIER`. The Cloudinary preset must allow unsigned image uploads. A device needs a reachable backend URL; localhost refers to the phone itself.

Backend variables: `PORT`, `NODE_ENV`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `CLOUDINARY_CLOUD_NAME`. Authentication/SMS configuration: `SEND_SMS_HOOK_SECRET`, `PHILSMS_API_TOKEN`, `PHILSMS_SENDER_ID`, `PHILSMS_DELIVERY_ENABLED`. Optional mapping/diagnostics: `OSRM_BASE_URL`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `MAPS_USER_AGENT`, `DEBUG_DELIVERY_LOCATION`.

Babel reads the three public upload/API variables from local dotenv or the EAS process environment. The development, preview and production EAS profiles explicitly select matching environments. Supabase public configuration uses Expo public variables. Never put service-role keys, PhilSMS tokens or Cloudinary secrets in mobile. See [EAS build notes](mobile/EAS_BUILD.md) and [Auth setup](AUTH_SUPABASE_SETUP.md).

## Database and deployment

The September 16 read-only hosted inspection recorded in [DELIVERY_RELIABILITY_REPORT.md](DELIVERY_RELIABILITY_REPORT.md) found the destination snapshot columns, rider accuracy, POD column and completion/status RPCs missing. This documentation update did not re-inspect or modify the hosted database. **Deploy the database before the API and rebuilt mobile app.**

Use the complete guarded rollout in [delivery_location_policy.sql](backend/sql/delivery_location_policy.sql). It includes an inspection query and aborts on incompatible schema. It adds only missing required columns and installs the current functions, schedule trigger and access restrictions. It supersedes `delivery_tracking_maps.sql` plus `delivery_proof.sql` for this rollout; do not subsequently reapply the historical proof function and restore its old radius policy. Existing Auth and avatar migrations are separate; do not rerun them blindly. Hosted avatar columns were present in the latest read-only audit.

The older `schema_complete.sql` and incremental inventory scripts are historical setup sources, not a complete universal installer for the current hosted schema. In particular, saved-address/tracking tables and some hosted runtime columns originated outside that base file. Do not run `reset_data.sql` as a migration.

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

The test suite includes Auth/security, avatars, checkout, cross-role inventory handoff, POD/upload retry, GPS/radius, ETA and local PostgreSQL/PGlite migration checks. Main mobile has no configured lint/typecheck script. A successful web export does not validate a native release or real GPS/camera/provider setup. See [delivery verification report](DELIVERY_RELIABILITY_REPORT.md) for results, remaining deployment work and a rider-phone test script.

The asynchronous UI report also records successful Web, Android and iOS/Hermes production bundles. These are bundle checks, not signed release builds or hosted end-to-end acceptance. For optional starter-only checks, run `npm.cmd run lint --prefix VeggieTrack-Clean`, then run `npx.cmd --no-install tsc --noEmit` from `VeggieTrack-Clean/`.

## Related documentation

- [Current project status](STATUS_REPORT.md)
- [Asynchronous UI changes and verification](AJAX_IMPLEMENTATION_REPORT.md)
- [Delivery reliability, guarded SQL and manual rider tests](DELIVERY_RELIABILITY_REPORT.md)
- [Supabase authentication and SMS setup](AUTH_SUPABASE_SETUP.md)
- [Profile photo implementation and hosted verification limits](CHUNK1_AVATARS_REPORT.md)
- [EAS build and environment setup](mobile/EAS_BUILD.md)
