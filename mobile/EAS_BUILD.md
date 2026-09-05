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

## Native project maintenance

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
