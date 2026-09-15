-- INSPECTION ONLY. Run in the configured Supabase project's SQL Editor.
-- Returns one JSON cell. No passwords, password hashes, tokens, full phones,
-- email addresses, user metadata, or function bodies are returned.
BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
  'users_columns', (SELECT jsonb_agg(jsonb_build_object(
    'column', column_name, 'type', udt_name, 'nullable', is_nullable))
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'),
  'roles', (SELECT jsonb_agg(x) FROM (
    SELECT role::text, count(*) AS count FROM public.users GROUP BY role
  ) x),
  'distributors', (SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'phone_masked', '***' || right(phone, 4), 'created_at', created_at))
    FROM public.users WHERE role::text = 'distributor'),
  'account_state', (SELECT jsonb_agg(jsonb_build_object(
    'id', u.id, 'role', u.role,
    'auth_user_id', to_jsonb(u)->>'auth_user_id',
    'supabase_user_id', to_jsonb(u)->>'supabase_user_id',
    'status', to_jsonb(u)->>'status', 'account_status', to_jsonb(u)->>'account_status',
    'phone_verified_at', to_jsonb(u)->>'phone_verified_at',
    'approved_at', to_jsonb(u)->>'approved_at', 'approved_by', to_jsonb(u)->>'approved_by',
    'disabled_at', to_jsonb(u)->>'disabled_at')) FROM public.users u),
  'credential_format_counts', (SELECT jsonb_agg(x) FROM (
    SELECT CASE
      WHEN password_hash IS NULL OR password_hash = '' THEN 'missing'
      WHEN password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN 'bcrypt-shaped'
      WHEN password_hash LIKE '$argon2%' THEN 'argon2-prefixed'
      ELSE 'other-needs-review'
    END AS format, count(*) AS count
    FROM public.users GROUP BY 1
  ) x),
  'auth_users', (SELECT jsonb_agg(jsonb_build_object(
    'auth_id', a.id, 'same_id_profile', u.id,
    'phone_present', nullif(a.phone, '') IS NOT NULL,
    'phone_confirmed_at', a.phone_confirmed_at,
    'password_present', nullif(a.encrypted_password, '') IS NOT NULL,
    'banned_until', a.banned_until))
    FROM auth.users a LEFT JOIN public.users u ON u.id = a.id),
  'identity_provider_counts', (SELECT jsonb_agg(x) FROM (
    SELECT provider, count(*) AS count FROM auth.identities GROUP BY provider
  ) x),
  'rls_tables', (SELECT jsonb_agg(jsonb_build_object(
    'table', c.relname, 'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
  'rls_policies', (SELECT jsonb_agg(jsonb_build_object(
    'schema', schemaname, 'table', tablename, 'policy', policyname,
    'permissive', permissive, 'roles', roles, 'command', cmd,
    'using', qual, 'with_check', with_check)) FROM pg_policies
    WHERE schemaname IN ('public', 'storage')),
  'user_foreign_keys', (SELECT jsonb_agg(jsonb_build_object(
    'table', conrelid::regclass::text, 'name', conname,
    'definition', pg_get_constraintdef(oid))) FROM pg_constraint
    WHERE contype = 'f' AND (confrelid IN ('public.users'::regclass, 'auth.users'::regclass)
      OR conrelid IN ('public.users'::regclass, 'auth.users'::regclass))),
  'user_indexes', (SELECT jsonb_agg(jsonb_build_object('name', indexname, 'definition', indexdef))
    FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users'),
  'triggers', (SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname, 'trigger', t.tgname,
    'enabled', t.tgenabled, 'function', p.oid::regprocedure::text))
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')),
  'public_functions', (SELECT jsonb_agg(jsonb_build_object(
    'function', p.oid::regprocedure::text, 'security_definer', p.prosecdef,
    'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'),
  'api_table_grants', (SELECT jsonb_agg(jsonb_build_object(
    'grantee', grantee, 'table', table_name, 'privilege', privilege_type))
    FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')),
  'api_user_column_grants', (SELECT jsonb_agg(jsonb_build_object(
    'grantee', grantee, 'column', column_name, 'privilege', privilege_type))
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'users'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')),
  'migration_catalog', (SELECT jsonb_agg(jsonb_build_object(
    'schema', table_schema, 'table', table_name, 'column', column_name))
    FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations'
      OR (table_schema IN ('public', 'auth') AND table_name ILIKE '%migration%'))
)) AS safe_auth_inspection;

ROLLBACK;

-- If migration_catalog reports supabase_migrations.schema_migrations.version,
-- run the following separately (otherwise skip it):
-- BEGIN TRANSACTION READ ONLY;
-- SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
-- ROLLBACK;
-- Do not export the migration statements column: it may contain embedded secrets.
