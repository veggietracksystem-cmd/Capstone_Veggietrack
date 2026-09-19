-- Email-only authentication rollout. Run after email_otp_verification_migration.sql.
-- This preserves any old phone values as historical contact data, but removes
-- them from identity, verification, approval and new-account requirements.
BEGIN;

-- New accounts have no phone value. Existing records are retained to avoid
-- destroying historical delivery data during an authentication migration.
ALTER TABLE public.users ALTER COLUMN phone DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.vt_sync_auth() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; requested_role text;
BEGIN
  SELECT * INTO u FROM public.users WHERE id=NEW.id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    IF FOUND THEN
      IF u.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Identity import mismatch'; END IF;
      UPDATE public.users SET auth_user_id=NEW.id, email=lower(trim(NEW.email)) WHERE id=u.id;
    ELSE
      requested_role := NEW.raw_user_meta_data->>'role';
      IF requested_role IS NULL OR requested_role NOT IN ('farmer','retailer','delivery_personnel') THEN RAISE EXCEPTION 'Public registration role not allowed'; END IF;
      IF nullif(trim(NEW.raw_user_meta_data->>'full_name'),'') IS NULL THEN RAISE EXCEPTION 'Name required'; END IF;
      INSERT INTO public.users(id,auth_user_id,full_name,email,role,account_status,farm_location,store_location,service_area,latitude,longitude)
      VALUES(NEW.id,NEW.id,left(trim(NEW.raw_user_meta_data->>'full_name'),120),lower(trim(NEW.email)),requested_role::public.user_role,
        CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN 'pending_approval' ELSE 'unverified' END,
        left(NEW.raw_user_meta_data->>'farm_location',500),left(NEW.raw_user_meta_data->>'store_location',500),left(NEW.raw_user_meta_data->>'service_area',500),
        (NEW.raw_user_meta_data->>'latitude')::numeric,(NEW.raw_user_meta_data->>'longitude')::numeric);
    END IF;
  ELSIF u.auth_user_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Missing application identity';
  ELSIF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL AND NOT u.legacy_access THEN
    UPDATE public.users SET account_status='pending_approval' WHERE id=u.id AND account_status='unverified';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vt_auth_update ON auth.users;
CREATE TRIGGER vt_auth_update AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.vt_sync_auth();
COMMIT;
