-- MANUAL FINAL STEP ONLY: after all 12 imports and staging login validation.
-- Removes obsolete credential columns, not accounts or business data.
BEGIN;
LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.users WHERE legacy_access)<>12 OR EXISTS (
   SELECT 1 FROM public.users u LEFT JOIN auth.users a ON a.id=u.auth_user_id
   WHERE u.legacy_access AND (a.id IS NULL OR a.id<>u.id OR a.phone_confirmed_at IS NULL
     OR public.vt_phone(a.phone)<>public.vt_phone(u.phone) OR nullif(a.encrypted_password,'') IS NULL)
 ) THEN RAISE EXCEPTION 'Legacy Auth import is incomplete; credentials preserved'; END IF;
END $$;
ALTER TABLE public.users DROP COLUMN password_hash, DROP COLUMN reset_password_token, DROP COLUMN reset_password_expires;
COMMIT;
