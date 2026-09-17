Last reviewed: 2026-09-16

# Delivery reliability and full-system verification report

Local implementation and automated verification are complete. **Hosted deployment and physical-phone acceptance are not complete.** The read-only hosted inspection identified missing delivery schema; no production database writes, paid SMS, real photo uploads or deployment were performed.

## 1. Root causes, separately

| Issue | Finding and correction |
|---|---|
| A: real offline | NetInfo is the only source of an offline claim. Unknown/error connectivity states permit an attempt. Submission checks connectivity before work and after network failures. |
| B: Cloudinary rejection | Upload handling conflated network/provider failures and did not reliably parse non-JSON errors. It now checks HTTP status and hosted URL, classifies rejection and blocks completion. |
| C: Cloudinary configuration | Missing/placeholder cloud or preset is rejected before sending; unsigned-preset/provider configuration errors get a distinct internal code. The real preset's permissions could not be verified without a real upload/account access. |
| D: image preparation | Native assets were treated too generically. file/content URIs are preserved/normalized, MIME and filename agree, and unsupported/unknown formats fail explicitly. Multipart boundary is supplied by fetch; no manual multipart header. |
| E: backend unreachable | API fetch rejection now has BACKEND_UNREACHABLE and the exact server-unreachable message, not an invented offline diagnosis. |
| F: backend 4xx | Error status/payload survive. Completion failure retains the uploaded URL and displays the requested completion-failed message plus useful validation details. |
| G: 401 | Current-session unauthorized handling remains; POD displays session expiry. Late unauthorized responses cannot sign out another session. |
| H: timeout | Cloudinary and API requests lacked bounded failure behavior. Both now have 30-second abort/deadline handling, including hanging body reads. GPS acquisition also has bounded deadlines. |
| I: 5xx | Server rejection stays a completion failure, never an internet error or success. A malformed 2xx completion payload is also rejected. |
| GPS/proximity | Existing code used one GPS sample and inconsistent age/accuracy thresholds. Verification now requires two distinct acceptable sample timestamps, retains the best accuracy and rejects stale/poor/mocked fixes. |
| Radius | Actual prior server/SQL rule was 150 m minus GPS uncertainty with a 50 m accuracy limit, rather than the described 50 m-only rule. Replaced consistently with the requested capped allowance policy. |
| Destination | Tracking resolved legacy addresses while completion used only snapshots. The same precedence now resolves snapshots, matching saved pins and matching store pins in API/tracking/SQL. Multiple conflicting saved pins fail closed. |
| ETA | Viewer ETA used the static warehouse corridor and map duration scaling could imply a false live estimate. Only the current rider leg's OSRM duration is live. |
| Races | GPS capture order was not enforced; polling could retain late requests; duplicate taps/status changes could overlap. Added capture-time write conditions, generation guards, abort cleanup and one active submission/action. Routing is serialized and deduplicated. |
| Hosted schema | Order snapshot columns, user GPS accuracy, deliveries.pod and both completion/status RPCs were absent in read-only metadata/zero-row queries. Prepared a guarded combined rollout; no hosted application attempted. |
| SQL history | veggietrack_fixes.sql failed on the checked-in base schema because delivery_status/pickup_status enums do not exist when statuses are TEXT. Added actual-type inspection before optional enum changes; local rerun passed. |
| Tests/tooling | Removed the Node module-type warning through explicit ESM test loading. Corrected a GPS test at the exact freshness boundary and centralized freshness classification. The separate starter lacked ESLint setup, had an effect-based hydration lint error and lacked Expo CSS declarations; configured tooling, used useSyncExternalStore and referenced Expo's existing CSS types. |

## 2. Files changed

Created:

- backend/lib/locationPolicy.js
- backend/scripts/inspect_delivery_schema_readonly.js
- backend/sql/delivery_location_policy.sql
- backend/test/crossRoleSmoke.test.js
- backend/test/mobileEnvironment.test.js
- backend/test/schemaHistory.test.js
- backend/test/deliveryReliability.test.js
- mobile/src/lib/deliveryLocation.js
- mobile/src/lib/deviceLocation.js
- mobile/src/lib/locationSamples.js
- mobile/src/lib/podSubmission.js
- mobile/src/lib/trackingJourney.js
- VeggieTrack-Clean/eslint.config.js
- VeggieTrack-Clean/src/css.d.ts
- DELIVERY_RELIABILITY_REPORT.md

Modified implementation/configuration/tests:

- backend/index.js
- backend/lib/deliveryProof.js
- backend/lib/deliveryTracking.js
- backend/sql/veggietrack_fixes.sql
- backend/test/authClient.test.js
- backend/test/deliveryProof.test.js
- backend/test/deliveryProofSql.test.js
- backend/test/deliveryTracking.test.js
- backend/test/podMobile.test.js
- mobile/babel.config.js
- mobile/eas.json
- mobile/src/api/client.js
- mobile/src/components/DeliveryTrackingMap.js
- mobile/src/components/ProofPreviewModal.js
- mobile/src/hooks/useDeliveryTracking.js
- mobile/src/hooks/useRiderLocation.js
- mobile/src/lib/cloudinary.js
- mobile/src/lib/podCapture.js
- mobile/src/screens/DeliveryDetailsScreen.js
- VeggieTrack-Clean/package.json
- VeggieTrack-Clean/package-lock.json
- VeggieTrack-Clean/src/hooks/use-color-scheme.web.ts

Documentation paths are listed in section 11. No source files were deleted by this task. The original untracked backend/scripts/inspect_delivery_readonly.js was preserved and used. test_output.txt was not removed. Git history advanced during this session; the list covers the delivery implementation relative to the avatar checkpoint, including subsequent working-tree verification fixes. An independently recorded mobile/.gitignore change is preserved.

No new main-app/backend runtime library was introduced. The separate starter's existing lint command required ESLint and eslint-config-expo development dependencies; Expo installed its supported preset. Installation reported ESLint deprecation and 14 moderate dependency advisories; no potentially breaking audit-force upgrade was performed.

## 3. Location policy constants

| Constant | Value | Rationale |
|---|---|---|
| BASE_DELIVERY_RADIUS_METERS | 100 | Allows normal store entrances/loading areas without a broad fence. |
| MAX_ACCURACY_ALLOWANCE_METERS | 50 | Caps GPS uncertainty's effect; radius never exceeds 150 m. |
| STALE_LOCATION_SECONDS | 60 | Rejects stale fixes while allowing upload/verification work. |
| MAX_ACCEPTABLE_GPS_ACCURACY_METERS | 100 | Rejects unusable readings before distance classification. |

Effective radius = 100 + min(valid accuracy, 50). At 115 m with 20 m accuracy the result is allowed (120 m radius); at 125 m with the same accuracy it is rejected. A 1 km accuracy reading is rejected. Haversine uses Earth radius 6,371,000 m. Existing 30-second future clock-skew tolerance remains. Frontend checks support UX; API and atomic database function enforce the decision.

## 4. ETA logic

Before pickup: rider -> warehouse. After pickup: rider -> resolved destination. Only one LIVE ETA label is rendered in the shared map; duration comes directly from the active OSRM leg and formats as whole minutes/hours. The static corridor remains available as map geometry/estimated-route metadata but is never substituted into live ETA.

Recalculate on target change, missing route, at least 50 m rider movement, active-route age of 30 seconds, or more than 75 m off-route deviation. Static corridor cache lasts five minutes. Failed routing is cached for 15 seconds to limit repeated provider failures. Missing route, stale GPS, completed/cancelled delivery or demo mode suppress live ETA. GPS publishing has no dependency on OSRM succeeding. Requests are serialized/deduplicated; delayed-response movement regression passes.

## 5. Corrected POD sequence

Open delivery -> fresh high-accuracy refinement -> resolve actual destination -> Haversine and capped-accuracy verification -> choose/capture photo -> submit (one active operation) -> refresh/verify GPS -> upload -> refresh/verify again after upload -> backend verifies session, assignment, state, photo and GPS -> Cloudinary footer render checked -> SQL locks/rechecks and atomically stores proof and delivered statuses -> backend confirms -> UI confirms.

Recoverable failures keep the selected image. If upload succeeded, retry reuses that URL for the same selected photo. A completion retry after a lost response returns the already-saved proof; it cannot overwrite proof or regress status. Backend rejection details are preserved. Exact requested upload/offline/server/completion messages are implemented; poor-accuracy refresh and completion messages remain distinct from outside-radius errors.

## 6. Database changes

Migration is required. Hosted read-only queries confirmed missing orders.delivery_latitude, orders.delivery_longitude, users.current_location_accuracy and deliveries.pod; complete_delivery_with_proof and advance_delivery_status were absent. Existing IDs, addresses and status/timestamp columns were inspected. Avatar columns were present.

The complete combined SQL below is also backend/sql/delivery_location_policy.sql. It starts with SELECT inspection, checks required columns/types, adds only missing fields, and installs the new policy/atomic completion/status/schedule protections. Unexpected existing types abort the transaction. It preserves existing data and restrictive Auth access. No live migration was applied because the deployed schema differed from the old assumptions; the adapted rollout was tested locally and is supplied for reviewed manual deployment. Do not reapply historical delivery_proof.sql after it.

Local tests apply the baseline/inventory/image/status/tracking scripts, the historical proof migration and current rollout, Auth and avatar migrations to isolated PostgreSQL/PGlite fixtures. Reapplication, schema mismatch, rollback, role restrictions and proof idempotency are tested. Destructive reset and manual Auth credential-finalization scripts were not run; they are outside delivery rollout and have separate prerequisites.

## 7. Environment variables (names only)

Mobile: BACKEND_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, IOS_BUNDLE_IDENTIFIER.

Backend: PORT, NODE_ENV, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, CLOUDINARY_CLOUD_NAME, SEND_SMS_HOOK_SECRET, PHILSMS_API_TOKEN, PHILSMS_SENDER_ID, PHILSMS_DELIVERY_ENABLED.

Optional: OSRM_BASE_URL, MAP_TILE_URL, MAP_TILE_ATTRIBUTION, MAPS_USER_AGENT, DEBUG_DELIVERY_LOCATION.

## 8. Test results

- Final npm test --prefix backend: **106 passed, 0 failed, 0 skipped**.
- Backend index and every backend/lib/*.js syntax check: passed.
- Main mobile Expo web export: passed, no bundler warnings/errors in final log.
- All main mobile JavaScript modules compile with installed Expo Babel preset: passed in suite.
- Main mobile lint/typecheck: no configured scripts or TypeScript configuration; no rules disabled.
- Separate VeggieTrack-Clean npm run lint: passed after setup/hydration fix.
- Separate VeggieTrack-Clean tsc --noEmit: passed after loading Expo CSS types.
- Local PostgreSQL/PGlite: passed migration/proof/Auth/avatar integration tests. No production tests mutated records.
- Cross-role stateful smoke: 8 kg farmer harvest -> assigned rider pickup -> received traceable batch -> distributor listing -> 6 kg retailer checkout -> approval passed. Existing delivery tests cover status progression, authorized tracking, POD completion, failure and retry.
- Requested radius cases, extreme inaccuracy, missing destination, stale GPS, upload failure, backend retry, offline/unreachable distinction, duplicate taps, current-leg ETA and matching destination are covered. Poll cleanup/GPS guards also received code review; real device concurrency remains an acceptance test.
- Git diff whitespace check: passed. Git prints local line-ending/global-ignore permission notices unrelated to application behavior.
- Logs: mobile/.expo/delivery-verification/backend-tests.txt and web-export.txt.

Not testable here: installed Android/iOS app, real camera/content-URI transport, real Cloudinary preset permissions/upload, remote EAS variable values/build, hosted SQL application and end-to-end deployed authentication/provider behavior.

## 9. Rider-phone manual test script

1. After database/API/app rollout, sign in as an assigned rider. On another device sign in as the related retailer/distributor. Ensure warehouse and order pins are correct and different.
2. Open navigation before pickup. Confirm one LIVE ETA targets the warehouse and the viewer receives current rider GPS. Mark picked up, then in transit; confirm target and ETA switch to the order destination.
3. Open delivery details at the pin. Tap Refresh Location; verify distance/accuracy. Repeat around 40 m, 75 m and just beyond 100 m; compare the decision to 100 + min(accuracy, 50). At several hundred meters, completion must reject with the distance message.
4. Test poor reception, disabled GPS, denied permission and a stale fix. Poor accuracy must request refresh/open sky rather than say too far. Refresh outdoors and retry.
5. Capture/select a photo. Double-tap Submit: only one upload/completion runs, controls show busy, and no early delivered state appears.
6. Turn on airplane mode before submission: expect the exact offline message and retained photo. Restore connectivity and retry without recapture.
7. On a test deployment, make Cloudinary upload fail: expect upload-failed wording and unchanged delivery. Restore it and retry. Then simulate a backend rejection after upload: expect completion-failed wording/details; retry should reuse the upload.
8. Make the API unreachable while other internet access works: expect server-unreachable wording. Test expired session and a hanging request separately; neither should be mislabeled offline.
9. Disable OSRM on a test backend. GPS must continue on the viewer while ETA says unavailable. Restore routing and verify recovery/current leg. Change screens quickly during polling and check that old order data never replaces the active order.
10. Complete near the pin with acceptable GPS. Confirm both roles see delivered and the persisted proof/footer; repeat submission/reload and verify no duplicate proof or status regression.

## 10. Left undone and why

- Hosted migration/deployment: prohibited for this task and schema differed; exact inspected/adapted SQL supplied below.
- Native release/real provider/phone acceptance: no rider device or signed release/provider session available. No claim of full deployed correctness.
- Historical pickup batch creation and checkout stock writes remain multi-step API writes. Happy-path handoff passes, but full transactional fault recovery for those pre-existing inventory flows needs a separate inspected database design; changing them overnight would expand the migration and risk existing stock behavior. Pickup batch insertion failure is already surfaced by the API. No such live failure was triggered.
- Existing historical base schema omits hosted-only address/tracking structures. Current rollout guards existing installations; it is not a universal empty-database installer.
- No background GPS, hardware anti-spoof attestation, voice navigation, traffic prediction or offline maps added. Known mocked samples are rejected, but client GPS is not hardware proof.
- Starter dependency advisories/deprecated tooling reported during lint setup were not force-upgraded; a breaking Expo/toolchain upgrade is outside the safe delivery fix.
- No files were deleted and no secrets were printed, logged or committed by this task.

## 11. Documentation updated

README.md, STATUS_REPORT.md, DELIVERY_POD_AUDIT.md, CHUNK1_AVATARS_REPORT.md, AUTH_SUPABASE_SETUP.md, AUTH_CLEANUP_REPORT.md, AUTH_MIGRATION_INSPECTION.md, mobile/EAS_BUILD.md, DELIVERY_RELIABILITY_REPORT.md. Each has a Last reviewed line. Historical reports are retained with explicit superseding notes rather than silently presented as current deployment state.

References used for API/build review: [repository-required Expo 56](https://docs.expo.dev/versions/v56.0.0/), [starter Expo 57](https://docs.expo.dev/versions/v57.0.0/), and [EAS environments](https://docs.expo.dev/eas/environment-variables/). Runtime/API assertions above are verified against repository code and local tests.

## Manual SQL rollout

After reviewing the opening read-only inspection results, this guarded transaction adds the missing delivery fields and installs the current completion policy; incompatible schema aborts.

```sql
-- Read-only schema inspection MUST be reviewed before applying the transaction.
-- This combined rollout handles the missing columns/functions found by the hosted
-- read-only inspection. No hosted migration has been applied by this task.
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('orders','deliveries','users','delivery_addresses')
ORDER BY table_name, ordinal_position;

BEGIN;
DO $$
DECLARE expected record; actual_type text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('orders','id','uuid'), ('orders','retailer_id','uuid'), ('orders','distributor_id','uuid'),
    ('orders','delivery_personnel_id','uuid'), ('orders','status',null), ('orders','delivery_address','text'),
    ('orders','preferred_schedule','timestamp with time zone'),
    ('deliveries','id','uuid'), ('deliveries','order_id','uuid'), ('deliveries','delivery_personnel_id','uuid'),
    ('deliveries','status','text'), ('deliveries','proof_photo_url','text'), ('deliveries','delivered_at','timestamp with time zone'),
    ('users','id','uuid'), ('users','latitude',null), ('users','longitude',null), ('users','store_location','text'),
    ('delivery_addresses','user_id','uuid'), ('delivery_addresses','address','text'),
    ('delivery_addresses','latitude',null), ('delivery_addresses','longitude',null)
  ) AS required(table_name,column_name,data_type) LOOP
    SELECT c.data_type INTO actual_type FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name;
    IF actual_type IS NULL OR (expected.data_type IS NOT NULL AND actual_type <> expected.data_type)
      OR (expected.column_name IN ('latitude','longitude') AND actual_type NOT IN ('double precision','numeric','real'))
      OR (expected.column_name='status' AND expected.table_name='orders' AND actual_type NOT IN ('USER-DEFINED','text')) THEN
      RAISE EXCEPTION 'Schema inspection mismatch at %.%; aborting delivery rollout', expected.table_name, expected.column_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('orders','delivery_latitude','double precision'), ('orders','delivery_longitude','double precision'),
    ('users','current_location_accuracy','double precision'), ('deliveries','pod','jsonb')
  ) AS optional(table_name,column_name,data_type) LOOP
    SELECT c.data_type INTO actual_type FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name;
    IF actual_type IS NOT NULL AND actual_type <> expected.data_type THEN
      RAISE EXCEPTION 'Existing column type mismatch at %.%; aborting delivery rollout', expected.table_name, expected.column_name;
    END IF;
  END LOOP;
END; $$;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_latitude double precision;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_longitude double precision;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS current_location_accuracy double precision;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS pod jsonb;

-- Validate on insertion/rescheduling, not on unrelated updates to old orders.
CREATE OR REPLACE FUNCTION public.validate_delivery_schedule() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.preferred_schedule IS DISTINCT FROM OLD.preferred_schedule THEN
    IF NEW.preferred_schedule IS NULL OR NEW.preferred_schedule <= clock_timestamp() THEN
      RAISE EXCEPTION 'Delivery date and time cannot be in the past.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_delivery_schedule ON public.orders;
CREATE TRIGGER validate_delivery_schedule BEFORE INSERT OR UPDATE OF preferred_schedule
ON public.orders FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_schedule();

-- Service-role-only transaction: lock parent first, then delivery. Retrying after
-- a lost response returns the existing proof without overwriting it.
CREATE OR REPLACE FUNCTION public.complete_delivery_with_proof(
  p_delivery_id uuid, p_rider_id uuid, p_photo_url text, p_pod jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deliveries; o public.orders; v_order_id uuid;
  lat double precision; lng double precision; accuracy double precision; distance double precision;
  destination_lat double precision; destination_lng double precision; pin_count integer;
  coordinate_source text; effective_radius double precision; captured timestamptz;
BEGIN
  SELECT order_id INTO v_order_id FROM deliveries WHERE id = p_delivery_id;
  SELECT * INTO o FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO d FROM deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF d.id IS NULL OR d.delivery_personnel_id IS DISTINCT FROM p_rider_id
    OR o.delivery_personnel_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Delivery not assigned to you' USING ERRCODE = '22023';
  END IF;
  IF d.status = 'delivered' AND o.status::text = 'delivered' THEN RETURN d.pod; END IF;
  IF d.status IS DISTINCT FROM 'in_transit' OR o.status::text IS DISTINCT FROM 'in_transit' THEN
    RAISE EXCEPTION 'Delivery must be in transit' USING ERRCODE = '22023';
  END IF;
  -- Resolve exactly the same precedence as deliveryTracking.destinationFor.
  IF o.delivery_latitude BETWEEN -90 AND 90 AND o.delivery_longitude BETWEEN -180 AND 180 THEN
    destination_lat := o.delivery_latitude; destination_lng := o.delivery_longitude;
    coordinate_source := 'order_snapshot';
  ELSE
    SELECT count(DISTINCT (a.latitude,a.longitude)), min(a.latitude), min(a.longitude)
      INTO pin_count, destination_lat, destination_lng FROM delivery_addresses a
      WHERE a.user_id = o.retailer_id AND trim(coalesce(o.delivery_address,'')) <> ''
        AND lower(regexp_replace(trim(a.address),'\s+',' ','g')) = lower(regexp_replace(trim(o.delivery_address),'\s+',' ','g'))
        AND a.latitude BETWEEN -90 AND 90 AND a.longitude BETWEEN -180 AND 180;
    IF pin_count = 1 THEN coordinate_source := 'saved_address';
    ELSIF pin_count > 1 THEN destination_lat := null; destination_lng := null;
    ELSE
      SELECT u.latitude,u.longitude INTO destination_lat,destination_lng FROM users u
        WHERE u.id = o.retailer_id AND trim(coalesce(o.delivery_address,'')) <> ''
          AND lower(regexp_replace(trim(u.store_location),'\s+',' ','g')) = lower(regexp_replace(trim(o.delivery_address),'\s+',' ','g'))
          AND u.latitude BETWEEN -90 AND 90 AND u.longitude BETWEEN -180 AND 180;
      coordinate_source := 'retailer_store';
    END IF;
  END IF;
  IF destination_lat IS NULL OR destination_lng IS NULL THEN
    RAISE EXCEPTION 'Delivery location coordinates are unavailable. Contact the distributor.' USING ERRCODE = '22023';
  END IF;
  lat := (p_pod->>'latitude')::double precision;
  lng := (p_pod->>'longitude')::double precision;
  accuracy := (p_pod->>'accuracy')::double precision;
  IF lat IS NULL OR lng IS NULL OR NOT (lat BETWEEN -90 AND 90) OR NOT (lng BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Current GPS coordinates are required.' USING ERRCODE = '22023';
  END IF;
  IF accuracy IS NULL OR NOT (accuracy BETWEEN 0 AND 100) THEN
    RAISE EXCEPTION 'Your current GPS signal is too inaccurate to verify your location. Refresh your location and try again.' USING ERRCODE = '22023';
  END IF;
  captured := (p_pod->>'captured_at')::timestamptz;
  IF captured IS NULL OR captured < clock_timestamp() - interval '60 seconds'
    OR captured > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'Your GPS location has expired. Refresh your location and try again.' USING ERRCODE = '22023';
  END IF;
  distance := 12742000 * asin(sqrt(least(1.0,
    power(sin(radians(destination_lat - lat)/2),2) +
    cos(radians(lat))*cos(radians(destination_lat))*power(sin(radians(destination_lng-lng)/2),2))));
  effective_radius := 100 + least(accuracy,50);
  IF distance > effective_radius THEN
    RAISE EXCEPTION 'You are approximately % m from the delivery location. Move closer before completing this delivery.', round(distance) USING ERRCODE = '22023';
  END IF;
  IF p_photo_url IS NULL OR p_photo_url NOT LIKE 'https://res.cloudinary.com/%/image/upload/%' THEN
    RAISE EXCEPTION 'A valid uploaded proof photo is required.' USING ERRCODE = '22023';
  END IF;
  p_pod := p_pod || jsonb_build_object('location_status','verified','distance_meters',distance,
    'effective_radius_meters',effective_radius,'coordinate_source',coordinate_source,
    'submitted_at',clock_timestamp());
  UPDATE deliveries SET status = 'delivered', delivered_at = clock_timestamp(),
    proof_photo_url = p_photo_url, pod = p_pod WHERE id = d.id;
  UPDATE orders SET status = 'delivered' WHERE id = o.id;
  RETURN p_pod;
END; $$;
REVOKE ALL ON FUNCTION public.complete_delivery_with_proof(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery_with_proof(uuid,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.advance_delivery_status(p_delivery_id uuid, p_rider_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deliveries; o public.orders; v_order_id uuid;
BEGIN
  SELECT order_id INTO v_order_id FROM deliveries WHERE id = p_delivery_id;
  SELECT * INTO o FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO d FROM deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF d.id IS NULL OR d.delivery_personnel_id IS DISTINCT FROM p_rider_id
    OR o.delivery_personnel_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Delivery not assigned to you' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('picked_up','in_transit') OR p_status IS NULL
    OR o.status IS NULL OR o.status::text NOT IN ('approved','in_transit','picked_up') THEN
    RAISE EXCEPTION 'Invalid delivery status transition' USING ERRCODE = '22023';
  END IF;
  IF d.status = p_status THEN RETURN; END IF;
  IF d.status IS NULL OR NOT ((d.status = 'assigned' AND p_status = 'picked_up') OR (d.status = 'picked_up' AND p_status = 'in_transit')) THEN
    RAISE EXCEPTION 'Invalid delivery status transition' USING ERRCODE = '22023';
  END IF;
  UPDATE deliveries SET status = p_status WHERE id = d.id;
  UPDATE orders SET status = 'in_transit' WHERE id = o.id;
END; $$;
REVOKE ALL ON FUNCTION public.advance_delivery_status(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_delivery_status(uuid,uuid,text) TO service_role;
-- The application uses its authenticated Express API for all order/delivery
-- writes. Close legacy direct REST write grants that bypass that validation.
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.deliveries FROM anon, authenticated;
-- POD contains precise location. Restrict the legacy broad customer SELECT
-- policy to the participants of this order.
DROP POLICY IF EXISTS "Distributors and retailers read deliveries" ON public.deliveries;
CREATE POLICY "Distributors and retailers read deliveries" ON public.deliveries FOR SELECT
USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id
  AND (o.retailer_id = auth.uid() OR o.distributor_id = auth.uid())));
COMMIT;

```

## What to do next

1. Review the opening schema inspection and run the complete guarded SQL on the intended Supabase project; do not run old proof SQL afterward.
2. Configure the named environment variables and confirm the Cloudinary preset allows unsigned images.
3. Deploy backend, rebuild mobile, then run the two-device rider test script above.
4. Review the separate inventory transaction and starter dependency limitations before a broader release.