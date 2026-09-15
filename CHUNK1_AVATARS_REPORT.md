# Chunk 1 — Existing-account profile pictures

## Status

Implemented and verified locally. **The hosted Supabase migration has not been applied.**
No SQL-capable connector, direct PostgreSQL connection, or connected browser/SQL Editor
was available. The migration was applied successfully to an isolated PGlite PostgreSQL
fixture by the SQL integration test. No live user profile was modified and no real
picture was uploaded during testing.

Chunk 2 has not started. Public registration is unchanged; required signup photos
remain Chunk 4. The trusted distributor can edit its photo through Edit Profile.

## Behavior

- Edit Profile includes a picture preview and selection/upload control.
- Uploads reuse `mobile/src/lib/cloudinary.js`; no libraries or storage providers added.
- Save is blocked during an upload and after failure until a successful retry.
- Selection/upload alone does not change the stored profile. Save uses the existing
  owner-only `PUT /api/users/:id`, then refreshes the shared Auth profile.
- Shared avatars render on farmer/shared profile screens, messaging contacts,
  distributor pickup cards, and the existing ProfileButton component.
- Missing or failed images fall back to initials using existing layout/colors.
- Avatar URLs are limited to original uploads in the configured Cloudinary cloud.
- Database timestamps are authoritative; client-supplied timestamps cannot overwrite them.
- Existing accounts without pictures remain supported. Direct client table access
  remains restricted; all business writes continue through Express.

## Files created

- `backend/lib/avatar.js`
- `backend/sql/user_avatars.sql`
- `backend/test/userAvatars.test.js`
- `backend/test/userAvatarsSql.test.js`
- `backend/test/userAvatarsMobile.test.js`
- `mobile/src/components/UserAvatar.js`
- `mobile/src/components/ProfilePhotoField.js`
- `CHUNK1_AVATARS_REPORT.md`

## Files modified for this chunk

- `backend/.env.example`
- `backend/index.js`
- `backend/lib/accountRoutes.js`
- `mobile/src/components/ProfileButton.js`
- `mobile/src/screens/EditProfileScreen.js`
- `mobile/src/screens/ProfileScreen.js`
- `mobile/src/screens/FarmerProfileTab.js`
- `mobile/src/screens/MessagesScreen.js`
- `mobile/src/screens/DistributorDashboard.js`
- `mobile/src/i18n/translations/en.json`
- `mobile/src/i18n/translations/tl.json`

Pre-existing working-tree changes were preserved. Generated verification artifacts
are under ignored `mobile/.expo/`.

## Exact migration SQL and deployment prerequisite

The exact SQL applied in the local PostgreSQL test is
[`backend/sql/user_avatars.sql`](backend/sql/user_avatars.sql).
It adds nullable `avatar_url` and `profile_picture_updated_at`, a URL CHECK, a
timestamp trigger, and explicit denial of client column privileges. The transaction
requires `vt_account_context(uuid,uuid)` from the existing Auth migration.

Apply this complete file once in the configured Supabase project's SQL Editor
**before deploying the changed backend**, because its profile/contact queries now
select the new columns. Confirm the query succeeds, and verify the two columns,
`users_avatar_url_format` constraint and `vt_stamp_avatar` trigger exist.
No migration SQL has been executed against the hosted database in this chunk.

Keep `CLOUDINARY_CLOUD_NAME` configured on the backend and matching mobile.
The local backend/mobile cloud names already match, and the mobile upload preset
is configured. No environment secrets were printed or changed.

## Verification

| Check | Result |
|---|---|
| Baseline backend suite | 72 passed, 0 failed |
| Final `npm test --prefix backend` | **79 passed, 0 failed** |
| Final `npx expo export --platform web --output-dir .expo/avatar-export` from mobile | **Passed**, 873 modules, no warnings in final export log |
| Local migration integration | Passed: nullable legacy data, timestamp spoof prevention, invalid URLs, service-role access, client access denial, existing RLS policy retained |
| API tests | Passed: owner-only updates, configured cloud validation, unchanged legacy editing, avatar responses, distributor-only farmer contacts |
| Mobile interaction tests | Passed: staged upload, duplicate taps, failure/cancellation/retry/unmount, fallback image rendering, blocked Save and shared-profile refresh |
| Affected source whitespace check | Passed |
| Live read-only Auth/schema inspection | 12 linked Auth profiles, Auth columns present, avatar columns absent |
| Hosted migration / real-device upload | Not performed; requires SQL access and live authenticated device validation |

Logs: `mobile/.expo/avatar-verification/backend-tests.txt` and
`mobile/.expo/avatar-verification/web-export.txt`.

## Manual code trace

For each role, its existing profile action opens the existing Edit Profile screen.
The picture field invokes the installed Expo image picker from the user tap, uploads
through the existing Cloudinary helper, and stages only the returned hosted URL.
Save sends the URL to the existing own-profile route. That route validates the URL
and updates the authenticated user's ID only. PostgreSQL sets the timestamp and the
API returns the avatar fields. The existing AuthContext refresh reloads `/api/auth/me`,
whose account-context function includes the new user columns. Profile avatars then
use that shared user. Contacts receive current avatars through their existing poll;
distributor pickup cards receive them on the existing pickup refresh.

## Issues encountered

- The initial sandboxed read-only network inspection was denied. The approved
  escalated run succeeded; it issued GET requests only.
- The live state is newer than the earlier report: all 12 existing profiles now have
  Auth links. The avatar columns are still absent.
- SQL catalog verification/application remains unavailable through the connected
  tools. REST inspection cannot establish deployed trigger/RLS definitions.
- The existing backend test suite emits a Node module-type warning for the unchanged
  `mobile/src/lib/deliveryTrackingHtml.js` module.
- An export invocation inherited conflicting `NO_COLOR`/`FORCE_COLOR` variables.
  Removing `NO_COLOR` only in the verification process resolved that warning; no
  application configuration or dependencies changed.
- Live gallery access/upload and cross-device refresh still need acceptance testing.
  The interaction tests mock the picker/network; the web export is a build check.

## Review boundary

Stop after this report. Wait for the user's Chunk 1 review before Chunk 2.
