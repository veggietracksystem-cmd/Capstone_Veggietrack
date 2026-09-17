Last reviewed: 2026-09-16

## Historical inspection boundary

This document preserves the earlier Auth inspection checkpoint. Its proposed migration state is not a current deployment inventory. Follow [AUTH_SUPABASE_SETUP.md](AUTH_SUPABASE_SETUP.md) for Auth and [DELIVERY_RELIABILITY_REPORT.md](DELIVERY_RELIABILITY_REPORT.md) for the September 16 delivery schema inspection. Do not rerun historical Auth migration/credential cleanup based only on this record.

# Authentication migration: read-only inspection

> Superseded by [the implementation/deployment checklist](AUTH_SUPABASE_SETUP.md). The returned SQL results confirmed all 12 hashes are bcrypt-shaped, no Auth users/triggers/public functions, RLS disabled on 10 business tables, and the single distributor index. The legacy-preserving implementation is now in the workspace; no deployed migration/import was performed.

## Verified on September 15, 2026

Read-only REST and Auth Admin GET requests to the project configured in `backend/.env` succeeded. No database writes, account creation, sign-in, OTP requests or SMS occurred.

- Project reference: `vzcffpmuxlvqgjdsfuwb`. Confirm this is the deployment you intend to migrate.
- `public.users`: 12 rows (1 distributor, 5 delivery personnel/riders, 3 retailers, 3 farmers).
- Sole recorded distributor: `0a417507-1437-4d71-9e11-185f13a0a262`, phone ending `4151`, created August 6, 2026.
- Supabase Auth Admin API: zero users. No existing Supabase Auth identity or phone-confirmation evidence was found.
- All 12 stored phones pass normalized Philippine mobile syntax checks; no normalized duplicates. This does not prove ownership, reachability, or verification.
- REST schema exposes legacy `password_hash`, `reset_password_token`, and `reset_password_expires` columns. Their values were not fetched.
- No explicit Auth ID linkage, approval/status, or phone-verification columns appear in the exposed users schema.
- Backend configuration contains Supabase API credentials, but no direct PostgreSQL connection configuration. API access does not expose deployed RLS policies, foreign keys, triggers or migration catalogs.
- Repository SQL declares a single-distributor index, RLS, ownership policies, and user foreign keys. These remain unverified against deployed catalogs. There is no Supabase migration directory in this checkout; SQL scripts are under `backend/sql`. The cleanup report says the abandoned Firebase migration was not applied, but this is not proof of deployed state.

## Run the remaining inspection

1. Open https://supabase.com/dashboard/project/vzcffpmuxlvqgjdsfuwb/sql/new and confirm the project is the intended deployment.
2. Copy the complete contents of `backend/sql/auth_readonly_inspection.sql` into a new query. Run using the dashboard's database-owner/postgres connection so system catalogs and `auth` tables are visible.
3. Click **Run**. The transaction is explicitly read-only and ends with `ROLLBACK`. The SELECT returns one `safe_auth_inspection` JSON cell. If the UI selects the final transaction result, select the SELECT result tab.
4. Copy that JSON cell and return it. If a query fails, return the error text; do not substitute a `SELECT *` export.
5. If `migration_catalog` lists `supabase_migrations.schema_migrations` with a `version` column, run the optional three commented statements at the end of the file as a separate query, removing their `--` prefixes. Return only the version rows. Absence of that table does not prove no manual SQL migrations ran.
6. Privately confirm the sole distributor in **Table Editor > public > users**, filtering `id` to `0a417507-1437-4d71-9e11-185f13a0a262`. Check that the name and phone belong to your legitimate distributor. Return confirmation and ID only, not a screenshot of the full row (it contains credential fields).
7. Check **Authentication > Users** for the same project; the inspection found it empty. Report if your dashboard differs. Report any known manually applied authentication scripts.

The SQL returns account state, credential-format counts, Auth linkage/provider counts, RLS flags/policies, grants, user foreign keys/indexes, trigger/function metadata and migration catalog structure. It excludes password/hash values, reset tokens, emails, full phones, user metadata, and function bodies. Credential-format counts are only a compatibility preflight, not verification that the passwords work.

## Proposed migration approach — not applied

1. Keep every existing `public.users.id` and all business foreign keys and history. Treat these reviewed legacy accounts as grandfathered for approval; do not infer that they completed SMS verification.
2. Import compatible credentials server-side into Supabase Auth, linking Auth identities to the existing application records. The installed SDK's `AdminUserAttributes` supports `password_hash` and `id`. Confirm the deployed Auth import behavior in an isolated test before selecting same-ID import versus a unique Auth-ID mapping. Neither approach recreates public profiles.
3. Preserve existing passwords if the stored hashes are supported. Do not fetch plaintext passwords, implement custom password comparisons, or mark unsupported credentials migrated. If hashes are incompatible, report affected counts and resolve a supported migration method before cutover.
4. Model legacy access explicitly, separately from actual OTP verification. If Supabase requires administrator confirmation for imported phone/password identities, document that as grandfathered administrative trust; never fabricate historical OTP verification timestamps. New accounts must complete OTP and approval.
5. Pin distributor authorization to the reviewed legacy identity. Never accept distributor privilege from public signup metadata.
6. Add server-controlled status, transactional administration/audit operations, status-aware Express authorization and RLS. Protect role/status/phone columns before enabling Supabase client access. Review existing RPC permissions too.
7. Stage and validate the import plus application cutover together so the new requirements do not exclude legacy accounts. Current local auth is paused; this inspection does not restore login or establish the deployed app's current login behavior.
8. Implement new-user OTP/approval and authenticated phone-change verification. Synchronize current profile phone only after Auth verification, preserving identity, approval and history.

No deployed migration should run until the catalog results establish compatibility. This inspection adds no application authentication behavior.

## Local checks

- PASS: live read-only REST/Auth inventory.
- PASS: `node --check backend/scripts/inspect_auth_readonly.js`.
- PASS: read-only SQL executed in local PGlite/PostgreSQL fixture; raw phone and secret sentinel excluded from output.
- NOT RUN: deployed catalog SQL; requires the SQL Editor steps above.
- NOT RUN: authentication flow/SMS tests; no authentication implementation changed in this inspection.

To repeat the API inspection from repository root:

```powershell
node backend/scripts/inspect_auth_readonly.js
```

Expected result: schema column metadata, role counts, masked distributor details and identity-linkage candidates. Only GET requests are issued; credentials are read from the existing ignored `backend/.env` and are never printed. Phone matches are diagnostic candidates, not identity proof.

References: https://supabase.com/docs/guides/auth/managing-user-data (SQL Editor inspection of Auth tables), https://supabase.com/docs/reference/javascript/auth-admin-createuser (server-side Auth administration).
