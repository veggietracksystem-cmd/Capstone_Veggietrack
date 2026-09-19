-- Adds an email-OTP verification gate before new signups enter the
-- distributor approval queue. auth_email_password_migration.sql made every
-- new registration 'pending_approval' immediately, with no confirmation
-- step at all. This migration restores a gate: new accounts now start
-- 'unverified' and only move to 'pending_approval' once Supabase Auth
-- confirms the user's email (mobile prompts for the OTP code emailed by
-- Supabase and calls supabase.auth.verifyOtp({type:'signup'})).
--
-- Existing rows are untouched: legacy/grandfathered accounts (legacy_access)
-- and any account already sitting in pending_approval/active/declined/
-- disabled keep their current status regardless of whether they ever
-- confirmed an email or phone. This only changes behavior for signups
-- created after this migration runs.
BEGIN;

CREATE OR REPLACE FUNCTION public.vt_sync_auth() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; p text; requested_role text; metadata_phone text;
BEGIN
 metadata_phone := nullif(trim(NEW.raw_user_meta_data->>'phone'),'');
 p := public.vt_phone(coalesce(metadata_phone,NEW.phone));
 SELECT * INTO u FROM public.users WHERE id=NEW.id FOR UPDATE;
 IF TG_OP='INSERT' THEN
   IF FOUND THEN
     IF u.auth_user_id IS NOT NULL OR public.vt_phone(u.phone)<>p THEN RAISE EXCEPTION 'Identity import mismatch'; END IF;
     UPDATE public.users SET auth_user_id=NEW.id WHERE id=u.id;
   ELSE
     requested_role := NEW.raw_user_meta_data->>'role';
     IF requested_role IS NULL OR requested_role NOT IN ('farmer','retailer','delivery_personnel') THEN RAISE EXCEPTION 'Public registration role not allowed'; END IF;
     IF nullif(trim(NEW.raw_user_meta_data->>'full_name'),'') IS NULL THEN RAISE EXCEPTION 'Name required'; END IF;
     IF metadata_phone IS NULL THEN RAISE EXCEPTION 'Mobile number required'; END IF;
     INSERT INTO public.users(id,auth_user_id,full_name,phone,email,role,account_status,farm_location,store_location,service_area,latitude,longitude)
     VALUES(NEW.id,NEW.id,left(trim(NEW.raw_user_meta_data->>'full_name'),120),p,lower(trim(NEW.email)),requested_role::public.user_role,
       CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN 'pending_approval' ELSE 'unverified' END,
       left(NEW.raw_user_meta_data->>'farm_location',500),left(NEW.raw_user_meta_data->>'store_location',500),left(NEW.raw_user_meta_data->>'service_area',500),
       (NEW.raw_user_meta_data->>'latitude')::numeric,(NEW.raw_user_meta_data->>'longitude')::numeric);
   END IF;
 ELSE
   IF u.auth_user_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Missing application identity'; END IF;
   IF NEW.phone IS DISTINCT FROM OLD.phone THEN
     IF NEW.phone_confirmed_at IS NULL OR u.account_status NOT IN ('active','pending_approval')
       OR nullif(OLD.phone_change,'') IS NULL OR public.vt_phone(OLD.phone_change)<>public.vt_phone(NEW.phone)
       OR nullif(OLD.phone_change_token,'') IS NULL OR nullif(NEW.phone_change,'') IS NOT NULL
       OR nullif(NEW.phone_change_token,'') IS NOT NULL THEN RAISE EXCEPTION 'Verified phone change is not allowed'; END IF;
     UPDATE public.users SET phone=public.vt_phone(NEW.phone),phone_verified_at=NEW.phone_confirmed_at WHERE id=u.id;
   ELSIF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL AND NOT u.legacy_access THEN
     -- Email OTP just confirmed: release the account into the distributor's
     -- approval queue. Only fires from 'unverified' - accounts already
     -- pending/active/declined/disabled (including pre-migration testing
     -- accounts that never verified) are left exactly as they are.
     UPDATE public.users SET account_status='pending_approval' WHERE id=u.id AND account_status='unverified';
   END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vt_auth_update ON auth.users;
CREATE TRIGGER vt_auth_update AFTER UPDATE OF phone, phone_confirmed_at, email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.vt_sync_auth();

COMMIT;
