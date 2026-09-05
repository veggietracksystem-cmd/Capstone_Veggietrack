# VeggieTrack

VeggieTrack is a capstone vegetable supply-chain app connecting farmers, a central distributor, retailers, and delivery riders. The Express/Supabase backend serves an Expo/React Native client targeting Android, iOS, and web.

Documentation reviewed: **September 6, 2026**. This describes the current workspace, including delivery-map changes that are still uncommitted. See [STATUS_REPORT.md](STATUS_REPORT.md) for verification and release readiness.

## Roles and features

| Role | Available workflows |
| --- | --- |
| Farmer | Record and edit harvests, request pickups, inspect harvest history, export weekly reports |
| Distributor | Receive pickups into inventory, manage/list stock, approve orders, assign riders, record payments, view inventory reports |
| Retailer | Browse produce, filter categories, manage cart and saved addresses, select delivery schedules, place/cancel orders, inspect order history and delivery tracking |
| Delivery personnel | Review assigned pickups/deliveries, accept status workflows, navigate to the hub and retailer, reject deliveries, upload proof and complete deliveries |

Shared functionality includes phone/password registration and login, token refresh and persistent sessions, profile editing, notifications with navigation links, polling-based messaging and unread counts, a user guide, and contact/support screens. A single distributor is enforced by the API and a database constraint.

Inventory supports FIFO batch provenance and stock lifecycle tracking. English and Tagalog translation resources and vegetable-name validation are present; newer tracking screens still contain English-only copy. Offline harvest caching and queued additions/edits support intermittent connectivity; this is not full offline support for every workflow. Reports use PDF printing and sharing, and images use Cloudinary uploads.

The interface uses shared leaf/gold/soil colors, Poppins typography, role dashboards, bottom navigation, cards, modals, and bottom sheets.

## Recent delivery tracking update (pending source commit)

- Shared Leaflet maps use OpenStreetMap tiles in a native WebView or web iframe. The pending changes remove `react-native-maps` and the Android Google Maps metadata.
- OSRM supplies road geometry, turn instructions, distance, and estimated travel duration through the backend.
- Rider navigation targets the distributor warehouse before pickup, then the retailer after pickup. GPS is shared while the rider screen is focused and the app is active.
- Retailer/distributor tracking polls every five seconds and displays the rider, location freshness/accuracy, warehouse, destination, contact, and order items.
- New orders snapshot the selected delivery pin. Existing orders fall back to a matching saved address, then a matching store location. Missing coordinates produce an explicit message.
- Tracking access is restricted to the order's retailer, distributor, or assigned rider. Demo simulation does not publish fake GPS or change delivery state.
- Routing requests are queued, deduplicated, cached, and bounded. GPS remains available if routing fails.

Background/locked-phone tracking, voice guidance, offline navigation, and live traffic are not implemented. Retailer ETA describes the hub-to-destination road route, not a continuously recalculated remaining rider arrival time.

## Tech stack

Versions below are declared in the current package manifests, not claims about the latest upstream releases.

| Layer | Technologies |
| --- | --- |
| API | Node.js, Express `^5.2.1`, CommonJS, dotenv, CORS |
| Database | Supabase PostgreSQL, `@supabase/supabase-js ^2.108.1`, SQL migrations |
| Authentication | JSON Web Tokens (`^9.0.3`), bcrypt (`^6.0.0`), SecureStore/client session handling |
| Client | Expo `^57.0.20`, React Native `0.86.3`, React/React DOM `19.2.3`, React Native Web `^0.21.0` |
| Navigation/UI | React Navigation 7, safe-area context, gesture handler, Expo vector icons, Poppins fonts |
| Mapping | Leaflet 1.9.4, OpenStreetMap, OSRM, Nominatim address search, Expo Location, WebView `13.16.1` |
| Local storage | Expo SQLite, AsyncStorage, NetInfo connectivity detection |
| Media/reports | Cloudinary unsigned uploads, Expo Image Picker, Print, Sharing |
| Supporting backend packages | date-fns `^4.4.0`, Twilio `^6.0.2`; SMS configuration remains for legacy/optional flows |
| Builds | Expo CLI, EAS profiles, checked-in Android Gradle project, Expo development client |

## Repository layout

```text
backend/
  index.js                 Express API routes
  lib/                     Vegetable validation and pending tracking service
  sql/                     Base schema and incremental migrations
  scripts/                 Maintenance utilities
  test/                    Pending delivery tracking regression suite
mobile/
  App.js                   App entry and navigation
  android/                 Native Android project
  EAS_BUILD.md             Build/deployment instructions and known build issues
  src/api/                 HTTP client and session refresh
  src/components/          Shared controls and platform-specific map frames
  src/context/             Authentication state
  src/hooks/               Pending tracking/GPS hooks
  src/i18n/                English and Tagalog resources
  src/lib/                 Maps, geometry, uploads, reports, validation
  src/offline/             Harvest cache and synchronization queue
  src/screens/             Role dashboards and workflows
  src/theme/               Shared design tokens
VeggieTrack-Clean/          Separate Expo project; main app instructions use mobile/
```

## Local setup

Use Node.js compatible with the declared Expo packages, npm, a Supabase project, and Cloudinary configuration for image uploads. Android native development requires the Android SDK/JDK; iOS native builds require macOS/Xcode.

From the repository root, set up the backend:

```powershell
cd backend
npm.cmd ci
Copy-Item .env.example .env
```

Configure `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, and a strong `JWT_SECRET` in `backend/.env`. `NODE_ENV` and optional `SMS_API_PH_KEY` are included in the example. Keep service credentials on the backend and never commit `.env` files.

For a new database, review and apply [schema_complete.sql](backend/sql/schema_complete.sql), then [veggietrack_fixes.sql](backend/sql/veggietrack_fixes.sql) and [fifo_inventory_upgrade.sql](backend/sql/fifo_inventory_upgrade.sql). Review `add_image_urls.sql` and `delivery_reject.sql` for the corresponding schema additions. Existing databases need only applicable migrations; the base schema is not a universal rerunnable installer. `reset_data.sql` is a destructive reset utility, not a setup migration.

Before deploying the pending tracking implementation, also apply `backend/sql/delivery_tracking_maps.sql` from that implementation. It adds order destination coordinates and rider GPS accuracy without deleting existing records.

```powershell
npm.cmd run dev
```

In another terminal, from the repository root:

```powershell
cd mobile
npm.cmd ci
Copy-Item .env.example .env
```

Set `BACKEND_URL` to the backend reachable by the device, plus `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET`. For a physical phone, use your computer's LAN IP during local development rather than `localhost`.

```powershell
npm.cmd start        # Metro / Expo development server
npm.cmd run android # Build/run the native Android app
npm.cmd run ios     # Build/run iOS on macOS
npm.cmd run web     # Web preview
```

On macOS/Linux use `npm` and copy examples with `cp`. Use a compatible development client for native testing.

## Deployment and verification

Deploy `backend/` to a Node host with the backend environment variables. For the pending maps implementation, optional variables are `OSRM_BASE_URL`, `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, and `MAPS_USER_AGENT`; `OSRM_BASE_URL=disabled` disables directions while keeping GPS tracking. Default public map services have capacity and availability limits; see [mobile/EAS_BUILD.md](mobile/EAS_BUILD.md) for configuration and deployment sequencing.

Run EAS from `mobile/`. The `development` profile creates a development client, `preview` is for internal distribution, and `production` is for store delivery. Set the backend URL and Cloudinary variables in the corresponding EAS environment before building. Rebuild the native binary after map dependency changes.

From the repository root, the current workspace can be checked with:

```powershell
node --check backend/index.js
node --test backend/test/deliveryTracking.test.js
```

The test file belongs to the pending tracking implementation. `backend/package.json` still has a placeholder `npm test` script. These checks do not validate a live database, production deployment, or device build. The build guide records unresolved local native compilation issues; a successful release APK/EAS build and two-device delivery acceptance check remain to be verified.
