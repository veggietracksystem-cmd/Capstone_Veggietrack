The requested scheduling and geotagged POD protections were not already implemented. The existing checkout only required nonempty date/time fields, the order API accepted past schedules, and completion accepted an optional photo without GPS. These gaps are now addressed in the source code and an additive database migration.

Deployment prerequisite: apply `backend/sql/delivery_tracking_maps.sql` if it has not been applied, then `backend/sql/delivery_proof.sql` in Supabase SQL Editor before deploying the updated API and mobile app. The new migration was executed and tested against isolated PostgreSQL via PGlite; it has not been applied to the live Supabase project. This workspace has API credentials but no configured SQL connection or SQL execution connector. No live orders, inventory, or delivery records were changed during testing. Rebuild the native app to include the camera/location permission configuration.

Changed files and purpose:

| File | Change |
| --- | --- |
| `backend/index.js` | Schedule enforcement, POD validation, atomic RPC calls, restricted progress transitions, and POD fields in read APIs |
| `backend/lib/deliveryProof.js` | Strict schedule parsing, Haversine distance, accuracy/freshness validation, Cloudinary footer URL, image rendering verification |
| `backend/sql/delivery_proof.sql` | POD storage, schedule trigger, destination backfill, atomic completion/progress functions, direct-write restrictions, participant-only POD reads |
| `backend/package.json` | Runnable test command; PGlite test dependency |
| `backend/package-lock.json` | Locked test dependency |
| `backend/test/deliveryProof.test.js` | Scheduling examples, API bypass, completion, image, metadata read and error tests |
| `backend/test/deliveryProofSql.test.js` | Real PostgreSQL migration, rollback, persistence, permissions and retry tests |
| `backend/test/podMobile.test.js` | Device/camera mocks, timezone parity, and compilation of mobile source |
| `mobile/app.json` | Expo camera and location permission plugins |
| `mobile/src/lib/deliverySchedule.js` | Explicit Philippine-time parsing, date keys, and schedule display |
| `mobile/src/lib/podCapture.js` | Fresh device GPS and camera/selection flow; accuracy, timeout, permission and capture errors |
| `mobile/src/components/DeliveryDateTimeFields.native.js` | Philippine calendar days and disabled past time slots |
| `mobile/src/components/DeliveryDateTimeFields.web.js` | Philippine date/time input minimums |
| `mobile/src/screens/OrderConfirmationScreen.js` | Live validation, disabled confirmation, submit-time recheck, explicit +08:00 payload, required map pin |
| `mobile/src/screens/DeliveryDetailsScreen.js` | Mandatory geotagged capture, retained retry state, API submission and Manila schedule display |
| `mobile/src/components/ProofPreviewModal.js` | Required photo/GPS confirmation and metadata preview |
| `mobile/src/components/ProofDetails.js` | Shared timestamps, coordinates, address when available, verification and distance display |
| `mobile/src/components/ImageViewerModal.js` | POD metadata beneath the full photo |
| `mobile/src/screens/RetailerDashboard.js` | Carry POD record into viewer; format schedule in Manila time |
| `mobile/src/screens/DistributorDashboard.js` | Carry POD record into viewer |
| `mobile/src/screens/OrderHistoryScreen.js` | Carry POD record into history viewer |
| `mobile/src/screens/OrderDetailsScreen.js` | POD metadata and formatted Manila schedule |
| `mobile/src/i18n/translations/en.json` | English validation and POD labels |
| `mobile/src/i18n/translations/tl.json` | Filipino validation and POD labels |
| `DELIVERY_POD_AUDIT.md` | This audit and rollout record |

Changed API endpoints:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/orders` | Reject invalid/past schedules with HTTP 422 before writes; normalize the instant; require destination coordinates |
| `PUT /api/deliveries/:id/status` | Allow assigned → picked_up → in_transit; update parent and delivery atomically; retries do not regress final records |
| `PUT /api/deliveries/:id/complete` | Require assigned rider, in-transit state, photo, fresh accurate GPS and destination match; generate/check footer; persist atomically |
| `GET /api/orders` | Include delivery POD metadata for retailer lists/history |
| `GET /api/orders/active` | Include POD metadata for distributor lists/history |
| `GET /api/orders/:id` | Include delivery and POD metadata for authorized order participants |
| `GET /api/delivery/orders` | Include delivery photo/POD metadata for the assigned rider |

There is no existing rescheduling endpoint. A PostgreSQL trigger also validates changes to `orders.preferred_schedule`, protecting subsequent database-side rescheduling without rejecting unrelated updates to old orders.

Database changes:

- Existing `orders.preferred_schedule` remains `timestamptz`. A trigger rejects null, current or past schedules on insertion or when the schedule changes.
- Existing `orders.delivery_latitude` / `delivery_longitude` remain the order's destination snapshot. New orders require a pin and no longer silently discard it when a migration is missing. The migration backfills historical missing pins only from one unambiguous matching saved address, then from a profile store whose address matches exactly after trimming/case normalization. Unresolved destinations remain blocked; an administrator must correct them using the intended destination, never a rider-supplied substitute.
- Existing `deliveries.proof_photo_url` stores the transformed photo reference and `delivered_at` is set by PostgreSQL.
- New `deliveries.pod` JSONB stores `latitude`, `longitude`, `accuracy`, `captured_at`, `submitted_at`, `location_status`, `distance_meters`, and nullable `address`. Keeping this metadata on the existing delivery avoids a parallel delivery system. Legacy POD remains null and is displayed as unverified.
- `complete_delivery_with_proof` locks the order and delivery, rechecks assignment/state/GPS/distance/freshness, writes proof and both delivered states in one transaction, and preserves existing proof on retry.
- `advance_delivery_status` updates rider progress and parent order state in one transaction. Both functions are executable only by the API's service role. Legacy direct REST mutation grants on orders/deliveries are revoked for anon/authenticated roles, and the broad customer POD read policy is restricted to order participants. The mobile app uses Express for these writes already.

Delivery datetime behavior:

The date and time are combined with explicit `+08:00`. Both client and server compare numeric instants against the actual current clock; offsetless legacy API input is interpreted as Manila wall time. Invalid calendar dates and clock values are rejected rather than normalized silently. Date-only input is rejected. UTC timestamps are stored normally and converted to Asia/Manila for schedule/POD display. Confirmation updates every second and rechecks immediately on submit; the server checks before inventory processing and again before saving. The database checks at insertion time. Existing native time slots and the seven-day picker window are preserved.

POD capture and verification behavior:

Opening proof requests foreground location permission and a valid current fix. The subsequent photo button opens the native camera, or the existing image selector on web. After the image returns, another fresh fix is attached to the photo. Coordinates are never editable and no map picker supplies POD coordinates. Expo web's cached-position default is explicitly overridden with `maximumAge: 0`. A reading must be no older than 30 seconds; known mocked native readings are rejected. The device fix timestamp becomes `captured_at`; the backend creates `submitted_at`, and PostgreSQL creates `delivered_at`. No timestamp form is provided.

The backend and PostgreSQL calculate Haversine distance to the order snapshot, using Earth radius 6,371,000 meters. The delivery radius is **150 meters**, allowing for store entrances and loading areas. Reported accuracy must be **50 meters or better**, and **distance + accuracy must be at most 150 meters**. Including uncertainty avoids verifying a reading whose uncertainty extends outside the area. Far-away, missing, stale, or inaccurate proof is rejected; the order remains in transit. Proof older than ten minutes must be recaptured, with at most 30 seconds of future device clock skew allowed.

The backend creates a Cloudinary raster transformation from the existing upload, with a leaf-green footer and white VeggieTrack label, submission date/time in PHT, latitude and longitude. The stored photo URL renders these pixels in the image itself, including when opened outside the app. The API requests the transformed image and requires a successful image response before saving completion. Arbitrary hosts, malformed photo URLs, pre-transformed input and uploads to a different configured cloud are rejected. The original upload remains in Cloudinary. Footer rendering follows [Cloudinary text-layer documentation](https://cloudinary.com/documentation/image_text_layers).

No reverse-geocoded address is invented. This implementation uses the required coordinates-only fallback; `address` remains null. The retailer's destination address is not presented as the rider's independently resolved GPS address. Native location/camera handling follows the installed Expo APIs and the repository-required [Expo location](https://docs.expo.dev/versions/v56.0.0/sdk/location/) and [ImagePicker](https://docs.expo.dev/versions/v56.0.0/sdk/imagepicker/) references.

Permission denial, disabled location, unavailable GPS, timeout, poor accuracy, stale GPS, camera denial/cancellation/failure and network/storage/API errors show errors and do not complete delivery. The GPS operation has a 20-second deadline, including permission lookup. The staged photo survives failed submission so the rider can retry; expired proof requires recapture. No offline completion is falsely marked successful. Existing farmer offline queues and cached read behavior remain intact.

Validation results:

- `cd backend; npm.cmd test`: **47 tests passed**, zero failures. Includes all five scheduling examples, past-date bypass, malformed dates, UTC/Manila parity and midnight, GPS permission/availability/accuracy/timeout cases, photo capture/cancellation/failure, nearby/far-away checks, POD metadata returned to both customer roles, API/RPC failure behavior, and existing tracking regressions.
- PostgreSQL/PGlite executed the migration twice, exercised trigger validation, backfilled a matching historical pin, persisted coordinates and distance, verified service-role permissions, checked idempotent completion, and forced failure on the order update to prove rollback of the delivery/POD update.
- Every mobile source JavaScript module compiled with the installed Expo Babel preset.
- `node --check backend/index.js`: passed.
- `npx.cmd --no-install expo export --platform web --output-dir dist-pod-check`: passed, 821 modules.
- `npx.cmd --no-install expo export --platform android --output-dir dist-pod-native-check`: passed, 1,174 modules and Hermes bytecode generated. The installed Hermes compiler required execution outside the sandbox.
- A public Cloudinary sample with the generated footer returned HTTP 200/image/jpeg and was visually inspected. This used illustrative coordinates, not a real delivery or user photo.

Physical-device GPS/camera permission prompts, real store deliveries, live Supabase migration/deployment, and the configured production Cloudinary account still require deployment/device verification. Unit mocks and bundle generation cannot establish real hardware behavior. Device coordinates from an untrusted client can be spoofed by a modified client or OS; these changes validate the ordinary app/API workflow and reject known mocked fixes, but are not hardware attestation. On web, the selected image may predate submission, so the footer explicitly labels submission time instead of claiming the original photograph was taken then.
