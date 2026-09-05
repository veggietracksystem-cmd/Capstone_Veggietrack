# VeggieTrack Project Status Report

**Reviewed:** September 6, 2026

**Scope:** Current local workspace on `main`, with existing uncommitted delivery-tracking work.

**Repository:** https://github.com/veggietracksystem-cmd/Capstone_VeggieTrack

This report distinguishes implemented source from verified deployment. This documentation update does not commit or deploy the pre-existing app changes. The previous report's blanket claim that all requirements were complete and fully operational is superseded by the evidence and remaining checks below.

## Current feature inventory

| Area | Implemented functionality |
| --- | --- |
| Accounts | Phone/password registration and login, session persistence/token refresh, profile edits, password/phone management, single-distributor restriction |
| Farmer | Harvest creation/editing/history, pickup requests, weekly reports, cached harvests and queued add/edit synchronization |
| Distributor | Pickup assignment/receipt, inventory listing/unlisting and quantity management, FIFO batches with harvest/farmer/pickup provenance, order approval, rider assignment, payment recording, weekly/inventory reports |
| Retailer | Produce browsing and category filters, cart and order confirmation, preferred schedule, saved delivery addresses and map pins, order cancellation/history, tracking screens |
| Delivery personnel | Assigned tasks, pickup/status updates, rejection, navigation, proof-of-delivery upload and completion |
| Communication | Polling-based message threads and unread badges, notifications/read state and navigation links |
| Shared UI | Role dashboards and bottom navigation, shared cards/modals/sheets, Poppins fonts and leaf/gold/soil palette, profile user guide and contact support |
| Language | English/Tagalog resources and matching backend/client vegetable validation, including kamatis, talong, repolyo, kalabasa, sibuyas, and bawang |
| Media and reports | Cloudinary image uploads; PDF generation, printing, and sharing |

Existing auth code also retains legacy OTP/email endpoints; the main phone/password flow should not be described as removal of every legacy endpoint. Offline support is scoped to the implemented caches and harvest queue, and new tracking strings are not yet fully translated.

## Recent changes present locally, pending source commit

### Shared delivery maps and tracking

The previous native/web and retailer tracking screens now delegate to a shared customer tracking screen and map components. Leaflet 1.9.4 runs inside a WebView on native and an iframe on web, with OpenStreetMap tiles. Pending package/Android changes remove the native Google Maps dependency and metadata.

New source includes:

- `backend/lib/deliveryTracking.js`: coordinate/destination resolution, authorized tracking responses, OSRM routing, caching, and turn instructions.
- `backend/sql/delivery_tracking_maps.sql`: additive destination-pin and GPS-accuracy migration.
- `backend/test/deliveryTracking.test.js`: backend, geometry, and embedded-map regression tests.
- `mobile/src/hooks/useDeliveryTracking.js` and `useRiderLocation.js`: focused polling and foreground rider GPS publishing.
- `mobile/src/components/DeliveryTrackingMap.js` and `DeliveryMapFrame.native.js` / `.web.js`: shared map UI and platform containers.
- `mobile/src/lib/deliveryTrackingHtml.js` and `trackingGeometry.js`: embedded Leaflet rendering, bridge messages, route progress, and demo geometry.
- `mobile/src/screens/CustomerDeliveryTrackingScreen.js`: order tracking with warehouse, retailer contact/address, status, and items.

### Rider navigation and viewer behavior

Navigation follows one active leg: rider to warehouse before collection, then rider to retailer after pickup. Directions, remaining distance, route progress, and ETA follow that target. Completion continues through the delivery details/proof workflow.

Foreground GPS is throttled to roughly five-second publishing intervals. Tracking viewers poll every five seconds while focused; location freshness and accuracy are surfaced. The tracking endpoint restricts private order/GPS/contact data to the related retailer, distributor, and assigned rider. Simulation is labeled as a demo and does not save fabricated GPS or change order status.

OSRM routes are deduplicated and queued below one request per second per backend process. Rider guidance is cached for 30 seconds, the warehouse-to-retailer corridor for five minutes, and routing failures briefly. Missing pins or unavailable directions produce explicit states while GPS remains usable.

### Address and supporting changes

Order confirmation sends delivery latitude/longitude so the backend can snapshot the chosen destination. Existing orders resolve matching saved address pins, with a matching profile store pin as a fallback; unrelated pins are not substituted. The address screen now uses `react-native-safe-area-context`, and the checkout delivery-address label is simplified. `mobile/EAS_BUILD.md` includes map deployment, configuration, device checks, and known native-build limitations.

## Current technology baseline

| Layer | Declared/current implementation |
| --- | --- |
| Backend | Node.js, Express `^5.2.1`, Supabase JS `^2.108.1` / PostgreSQL |
| Auth/utilities | JWT `^9.0.3`, bcrypt `^6.0.0`, dotenv, CORS, date-fns, Twilio dependency |
| Client | Expo `^57.0.20`, React Native `0.86.3`, React/React DOM `19.2.3`, React Native Web `^0.21.0` |
| UI/navigation | React Navigation 7, Poppins, vector icons, gesture handler, safe-area context |
| Maps | Leaflet 1.9.4, OpenStreetMap tiles, Nominatim geocoding, OSRM routes, Expo Location, WebView `13.16.1` |
| Storage/media | SQLite, AsyncStorage, NetInfo, SecureStore, Cloudinary, Expo Image Picker/Print/Sharing |
| Build | Expo CLI/development client, EAS development/preview/production profiles, checked-in Android Gradle sources |

These values come from local manifests and implementation. They replace the outdated Expo 54, React Native 0.81, Baloo/Inter, and native-map descriptions.

## Database and deployment dependencies

The schema history includes `schema_complete.sql`, `veggietrack_fixes.sql`, `fifo_inventory_upgrade.sql`, `add_image_urls.sql`, and `delivery_reject.sql`. Together these cover base entities, distributor uniqueness, notification links, coordinates/status additions, batch provenance, images, and rejection support. Review each migration against the target database; do not run the destructive `reset_data.sql` as a migration.

The pending tracking migration adds `orders.delivery_latitude`, `orders.delivery_longitude`, and `users.current_location_accuracy`. Deploy the tracking service and backend changes with that migration before the updated client. Compatibility fallbacks tolerate missing new columns temporarily, but persisted destination snapshots and accuracy need the migration.

Confirm the distributor warehouse pin and selected retailer delivery pin. Configure backend Supabase/JWT values and client `BACKEND_URL`/Cloudinary values in the appropriate deployment environment. Optional routing/tile variables and detailed build steps are in [mobile/EAS_BUILD.md](mobile/EAS_BUILD.md).

## Verification evidence

Checks rerun for this documentation review on September 6, 2026:

| Check | Result | Scope |
| --- | --- | --- |
| `node --check backend/index.js` | Passed | Backend JavaScript syntax |
| `node --test backend/test/deliveryTracking.test.js` | 14 passed, 0 failed | Local regression suite using fixtures/mocks and geometry/map checks |

The tests cover coordinate validation, destination precedence, turn instructions, route caching/failures, participant access, pickup-to-delivery navigation transitions, geometry/simulation, script escaping, and Leaflet marker updates. Node emitted a non-fatal module-type warning while importing mobile ES modules. `npm test` in the backend remains a placeholder; use the explicit command above.

The existing build guide records earlier Android/web exports and an Android debug dry run, but those were not rerun for this documentation-only update. It also records unsuccessful full Windows native compilation due to long paths and C++ runtime linker errors. Earlier test-count references in that guide are historical; the current suite has 14 tests.

## Remaining release checks and limitations

- Commit/review the pending app implementation separately; this documentation commit includes only README and this report.
- Apply the tracking migration and verify the deployed backend against the actual Supabase schema; deployment was not performed in this review.
- Obtain a successful native release/EAS build and test installation, login, persistence, uploads, maps, and PDF sharing on a device. iOS runtime behavior was not verified here.
- Test with an assigned rider and a related viewer on two devices: real GPS updates, permission denial, connectivity loss, correct pins, pickup transition, and completion with proof.
- Finish English/Tagalog coverage for new tracking copy.
- Foreground tracking requires the rider screen to remain open. Background/locked-phone tracking, voice instructions, offline maps/navigation, and live traffic are not implemented.
- Viewer ETA is the warehouse-to-retailer route duration, not live remaining rider travel time. Public routing and tile services have no guaranteed uptime; multiple backend processes need shared rate limiting or a suitable routing endpoint.

See [README.md](README.md) for setup and the feature overview.
