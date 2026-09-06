# Android builds

Run EAS commands from `mobile`, which contains the app's `eas.json` and lockfile.
Keep `package.json` and `package-lock.json` together when committing or uploading.
The current dependencies target Expo SDK 57 / React Native 0.86.3; the Gradle
wrapper matches the template shipped with the installed Expo package.

## Build commands

```powershell
cd mobile
npx.cmd expo install --check
npx.cmd eas-cli build --platform android --profile development --clear-cache
```

The development profile creates a development client that needs Metro.
For an installable standalone APK, use `--profile preview`. For a Play Store
Android App Bundle, use `--profile production`.

On macOS/Linux, use `npx` instead of `npx.cmd`.

## Preserve backend and image uploads

Set these existing app variables in the corresponding EAS environment
(`development`, `preview`, or `production`) before building:

- `BACKEND_URL`: the deployed backend HTTPS URL reachable from the phone.
- `CLOUDINARY_CLOUD_NAME`: the cloud used by the app.
- `CLOUDINARY_UPLOAD_PRESET`: the app's upload preset.

The local `.env` is ignored and is not sent to EAS. The existing Babel dotenv
plugin can read these variables from the build environment. Without them, the
backend falls back to localhost and image uploads lack their configuration.
See [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

## Free delivery maps: deploy backend before the app

Delivery maps use Leaflet, OpenStreetMap tiles, and OSRM road routing on Android
and web. No Google Maps API key, Google Cloud project, or billing account is
required. The native Google Maps dependency has been removed; rebuild the
Android binary to remove it from the installed app.

1. Run [`../backend/sql/delivery_tracking_maps.sql`](../backend/sql/delivery_tracking_maps.sql)
   in your Supabase SQL Editor. This additive migration saves the exact order
   destination pin and GPS accuracy; it preserves existing data.
2. Deploy the updated backend, including `backend/lib/deliveryTracking.js`.
   Existing orders resolve their destination from a matching saved delivery
   address. New orders snapshot the selected pin. The backend tolerates an older
   schema temporarily, but exact order pins and accuracy require the migration.
3. Check the distributor's saved **warehouse address and map pin** in their
   profile. This is the actual dispatch hub. Check the retailer's selected
   delivery address pin too. Missing pins are reported rather than substituting
   San Pablo city center for an actual warehouse or store.
4. Set `BACKEND_URL` in EAS to that deployed HTTPS backend, then build:

   ```powershell
   cd mobile
   npx.cmd eas-cli build --platform android --profile preview --clear-cache
   ```

The rider's Navigation screen shares real device GPS while focused and active,
and shows road turns, distance to the next maneuver, route progress, and ETA.
Before pickup it routes only from the rider to the warehouse; after the rider
marks picked up, it switches to the route from the rider to the retailer.
Directions, distance, ETA, and map recentering follow that active destination.
Delivery completion still opens the existing Delivery Details flow,
including delivery proof and status updates.

Distributor/retailer tracking polls every five seconds and displays the truck,
last update status, accuracy circle, warehouse, retailer address/contact, and
road ETA. Device/browser GPS displays the viewer's own location; only the
assigned rider publishes it. Simulation is labeled DEMO and never saves fake
GPS or changes delivery status. Keep the rider screen open: background/locked
phone tracking, spoken instructions, offline navigation, and live traffic are
not implemented. ETA is a road-duration estimate, not a traffic prediction.

### Public service limits and optional configuration

Defaults require no account or API key:

| Service | Default | Optional backend environment variable |
| --- | --- | --- |
| Road directions | `https://routing.openstreetmap.de/routed-car` | `OSRM_BASE_URL` |
| Map tiles | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | `MAP_TILE_URL` |
| Additional tile attribution | empty (OSM attribution is always shown) | `MAP_TILE_ATTRIBUTION` |
| Routing request identity | `VeggieTrack/1.0 (delivery navigation)` | `MAPS_USER_AGENT` |

Set `MAPS_USER_AGENT` to an app identifier with your deployment URL/contact.
Public routing is queued below one request per second per backend process,
deduplicated, and cached (30 seconds for rider guidance, five minutes for the
warehouse corridor). Run one process against the public router; multiple
instances need shared rate limiting or your own endpoint. `OSRM_BASE_URL=disabled`
turns off routing while retaining GPS tracking. Custom endpoints must use the
OSRM HTTP API and XYZ raster tile format respectively; use HTTPS in deployment.

These public services are free but have no uptime guarantee and prohibit heavy
use. Do not prefetch offline tiles or remove attribution. A larger deployment
needs a permitted provider or self-hosted services; open-source software is
free, but hosting is not guaranteed to be free. There is no automatic paid API
fallback. See the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
and [public routing usage limits](https://routing.openstreetmap.de/about.html).

### Device acceptance check

Use one assigned rider account and a related distributor/retailer account on
another device. Start rider navigation, grant GPS permission, and verify that
the truck and coordinates update on the viewer after the next poll. Check
warehouse/store pins, left/right instructions, pickup-to-retailer transition,
GPS accuracy, and completion with proof. Deny GPS or disconnect briefly and
confirm the last location is labeled correctly. Start and stop simulation and
verify the other device's live rider position is unchanged. Browser GPS needs
HTTPS (or localhost).

Run the local tracking regression tests from the repository root with
`node --test backend/test/deliveryTracking.test.js`.

## Native project maintenance

### Keep Android sources in sync

The Android namespace, application ID, and Kotlin entry classes must all remain
`veggietrack.com`. Changing the application ID would change the installed app's
identity and its access to existing app data.

This project includes its Android sources. EAS builds those files directly;
app.json plugin/config changes are not automatically synced into them. Preserve
native changes when updating Expo configuration. See the
[Android build process](https://docs.expo.dev/build-reference/android-builds/).

`android/.gitignore` excludes local Gradle, CMake, and generated build state.
Keep this file named `.gitignore`; a file named `gitignore` has no effect.

The repository-root `.easignore` also explicitly excludes these directories from
EAS uploads, while preserving Android sources, resources, and the Gradle wrapper.
On EAS, `settings.gradle` discards the generated autolinking JSON before linking
dependencies so restored caches cannot reuse Windows paths on Linux. Clearing
the remote cache alone does not remove stale files from an uploaded archive.

To inspect the upload without starting a cloud build, run from `mobile`:

```powershell
npx.cmd eas-cli build:inspect --platform android --profile development --stage archive --output "$env:TEMP/veggietrack-eas-archive"
```

Use a new output directory for each inspection. It should contain the Android
sources but no generated files inside `mobile/android/build`, `.gradle`,
`app/build`, or `.cxx`. The inspection may leave empty directory shells.

The Node path lookups in `android/app/build.gradle` check command failures and
resolve paths from the mobile directory. If a package is missing, restore the
locked dependencies with `npm.cmd ci` instead of changing the Gradle version.

## Validation

```powershell
cd android
.\gradlew.bat help --console=plain
.\gradlew.bat :app:assembleDebug --dry-run --console=plain
.\gradlew.bat :app:bundleRelease --console=plain
```

A dry run validates configuration and task selection; it does not compile an
APK. After a completed EAS build, check login, data persistence, location/maps,
image upload, and PDF export/sharing on a device before distributing the app.

The local map migration check passed Android/web JavaScript export, eleven
tracking regression tests, and `:app:assembleDebug --dry-run` with EAS cache
reset enabled. Full compilation on this Windows workspace stopped at native
CMake tasks: Ninja reported a filename longer than 260 characters under the
deep workspace path, and Expo modules reported unresolved C++ runtime symbols.
This is not a successful APK build. Use the EAS Linux build to validate the
deployment binary; its result still needs to be checked. For local native
builds, use a short workspace and Android SDK path without spaces and regenerate
local native build state. Do not upload `.cxx` or Gradle caches to EAS.
