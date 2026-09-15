-- Reviewed legacy cohort; additive migration. Run once, before importing Auth users.
-- Does not delete/recreate any application user or business record.
BEGIN;
LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='account_status') THEN
    RAISE EXCEPTION 'Authentication migration already applied or schema changed; inspect before proceeding';
  END IF;
  IF (SELECT count(*) FROM public.users) <> 12 OR
    NOT EXISTS (SELECT 1 FROM public.users WHERE id='0a417507-1437-4d71-9e11-185f13a0a262' AND role='distributor') OR
    (SELECT count(*) FROM public.users WHERE role='distributor') <> 1 OR
    EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'Preflight differs from reviewed inventory; no changes applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id NOT IN (
    '0a417507-1437-4d71-9e11-185f13a0a262','2e111805-31ed-4bac-9a5d-e2ce814d6596',
    '2f3ea56a-544f-4e86-8c02-919a440f9adb','348ae49c-2cd0-4663-b234-a229e4228f2b',
    '3d6e6300-0870-4552-9458-c7cf6f9d3d42','3d9f295b-62bd-4e52-a9b7-037c30009f15',
    '51d50bff-963c-4345-bed2-2a56ac1a474a','814bb0db-fd34-4b48-a58b-3d7db8b73752',
    'af3a388f-8586-4171-8126-dd0ab2fa0a83','b9e4b31a-9976-48ce-87ea-aceccc424808',
    'c2146ad4-8851-455a-b6d1-4489a2f3a20e','d74d3112-0d87-45fd-90b2-cc3003a75216')) THEN
    RAISE EXCEPTION 'Legacy cohort changed';
  END IF;
END $$;

ALTER TABLE public.users
 ADD COLUMN account_status text NOT NULL DEFAULT 'unverified' CHECK (account_status IN ('unverified','pending_approval','active','declined','disabled')),
 ADD COLUMN legacy_access boolean NOT NULL DEFAULT false,
 ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id),
 ADD COLUMN phone_verified_at timestamptz,
 ADD COLUMN approved_at timestamptz,
 ADD COLUMN approved_by uuid REFERENCES public.users(id),
 ADD COLUMN disabled_at timestamptz,
 ADD COLUMN status_reason text,
 ADD COLUMN login_not_before timestamptz,
 ADD COLUMN status_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;
-- Explicitly grandfather only the reviewed cohort, without claiming SMS verification.
UPDATE public.users SET legacy_access=true, account_status='active';

CREATE FUNCTION public.vt_phone(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
DECLARE p text := regexp_replace(value, '[[:space:]().-]', '', 'g');
BEGIN
 IF p ~ '^09[0-9]{9}$' THEN p := '+63'||substr(p,2);
 ELSIF p ~ '^9[0-9]{9}$' THEN p := '+63'||p;
 ELSIF p ~ '^639[0-9]{9}$' THEN p := '+'||p; END IF;
 IF p !~ '^\+639[0-9]{9}$' THEN RAISE EXCEPTION 'Invalid Philippine mobile number'; END IF;
 RETURN p;
END $$;
CREATE UNIQUE INDEX users_normalized_phone_key ON public.users(public.vt_phone(phone));

CREATE TABLE public.account_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_id uuid NOT NULL REFERENCES public.users(id),
 actor_id uuid NOT NULL REFERENCES public.users(id), action text NOT NULL CHECK(action IN ('APPROVED','DECLINED','DISABLED','REACTIVATED','PHONE_NUMBER_CHANGED')),
 previous_status text NOT NULL, resulting_status text NOT NULL, reason text,
 old_phone_masked text, new_phone_masked text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (action NOT IN ('DECLINED','DISABLED') OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);

-- Auth owns phone identity. A trigger makes Auth/profile synchronization atomic.
CREATE FUNCTION public.vt_sync_auth() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; p text; requested_role text;
BEGIN
 p := public.vt_phone(NEW.phone);
 SELECT * INTO u FROM public.users WHERE id=NEW.id FOR UPDATE;
 IF TG_OP='INSERT' THEN
   IF FOUND THEN
     IF NOT u.legacy_access OR u.auth_user_id IS NOT NULL OR public.vt_phone(u.phone)<>p THEN
       RAISE EXCEPTION 'Identity import mismatch';
     END IF;
     UPDATE public.users SET auth_user_id=NEW.id WHERE id=u.id;
   ELSE
     requested_role := NEW.raw_user_meta_data->>'role';
     IF requested_role IS NULL OR requested_role NOT IN ('farmer','retailer','delivery_personnel') THEN
       RAISE EXCEPTION 'Public registration role not allowed';
     END IF;
     IF nullif(trim(NEW.raw_user_meta_data->>'full_name'),'') IS NULL THEN RAISE EXCEPTION 'Name required'; END IF;
     INSERT INTO public.users(id,auth_user_id,full_name,phone,role,farm_location,store_location,service_area,latitude,longitude)
     VALUES(NEW.id,NEW.id,left(trim(NEW.raw_user_meta_data->>'full_name'),120),p,requested_role::public.user_role,
       left(NEW.raw_user_meta_data->>'farm_location',500),left(NEW.raw_user_meta_data->>'store_location',500),
       left(NEW.raw_user_meta_data->>'service_area',500),
       (NEW.raw_user_meta_data->>'latitude')::numeric,(NEW.raw_user_meta_data->>'longitude')::numeric);
   END IF;
 ELSE
   IF u.auth_user_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Missing application identity'; END IF;
   IF NEW.phone IS DISTINCT FROM OLD.phone THEN
     IF NEW.phone_confirmed_at IS NULL OR u.account_status NOT IN ('active','pending_approval')
       OR nullif(OLD.phone_change,'') IS NULL OR public.vt_phone(OLD.phone_change)<>p
       OR nullif(OLD.phone_change_token,'') IS NULL OR nullif(NEW.phone_change,'') IS NOT NULL
       OR nullif(NEW.phone_change_token,'') IS NOT NULL THEN
       RAISE EXCEPTION 'Verified phone change is not allowed';
     END IF;
     UPDATE public.users SET phone=p,phone_verified_at=NEW.phone_confirmed_at WHERE id=u.id;
     INSERT INTO public.account_audit(target_id,actor_id,action,previous_status,resulting_status,old_phone_masked,new_phone_masked)
     VALUES(u.id,u.id,'PHONE_NUMBER_CHANGED',u.account_status,u.account_status,'***'||right(u.phone,4),'***'||right(p,4));
   ELSIF NEW.phone_confirmed_at IS NOT NULL AND OLD.phone_confirmed_at IS NULL AND NOT u.legacy_access THEN
     UPDATE public.users SET phone_verified_at=NEW.phone_confirmed_at,
       account_status=CASE WHEN account_status='unverified' THEN 'pending_approval' ELSE account_status END WHERE id=u.id;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vt_auth_insert AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.vt_sync_auth();
CREATE TRIGGER vt_auth_update AFTER UPDATE OF phone,phone_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.vt_sync_auth();

-- No client has direct table privileges; Express verifies Auth and status on each request.
-- Existing role/ownership checks remain in Express. RLS provides defense in depth.
DO $$ DECLARE t text; c record; BEGIN
 FOREACH t IN ARRAY ARRAY['users','orders','order_items','deliveries','harvests','products','payments','messages','notifications','pickup_requests','delivery_addresses','delivery_tracking','account_audit'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY vt_api_only ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',t);
   FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
     EXECUTE format('REVOKE ALL (%I) ON public.%I FROM PUBLIC, anon, authenticated',c.column_name,t);
   END LOOP;
   EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION public.vt_account_context(p_auth_id uuid,p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; session_created timestamptz;
BEGIN
 SELECT * INTO u FROM public.users WHERE auth_user_id=p_auth_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT created_at INTO session_created FROM auth.sessions WHERE id=p_session_id AND user_id=p_auth_id;
 IF session_created IS NULL OR (u.login_not_before IS NOT NULL AND session_created<=u.login_not_before) THEN RETURN NULL; END IF;
 RETURN (to_jsonb(u)-'password_hash'-'reset_password_token'-'reset_password_expires') || jsonb_build_object(
   'access_allowed',u.account_status='active' AND (u.legacy_access OR (u.phone_verified_at IS NOT NULL
     AND EXISTS(SELECT 1 FROM auth.users a WHERE a.id=u.auth_user_id AND a.phone_confirmed_at IS NOT NULL
       AND public.vt_phone(a.phone)=public.vt_phone(u.phone)))));
END $$;

CREATE FUNCTION public.vt_admin_transition(p_actor uuid,p_session uuid,p_target uuid,p_action text,p_reason text,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; a jsonb; next_status text;
BEGIN
 -- Serialize distributor actions and validate authoritative actor/session again.
 PERFORM 1 FROM public.users WHERE id='0a417507-1437-4d71-9e11-185f13a0a262' FOR UPDATE;
 a := public.vt_account_context(p_actor,p_session);
 IF a IS NULL OR a->>'id'<>'0a417507-1437-4d71-9e11-185f13a0a262' OR a->>'role'<>'distributor' OR NOT (a->>'access_allowed')::boolean THEN
   RAISE EXCEPTION 'Distributor authorization required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO u FROM public.users WHERE id=p_target FOR UPDATE;
 IF NOT FOUND OR u.role='distributor' OR p_version IS NULL OR u.status_version<>p_version THEN RAISE EXCEPTION 'Stale or ineligible account'; END IF;
 next_status := CASE
   WHEN p_action='APPROVED' AND u.account_status='pending_approval' AND u.phone_verified_at IS NOT NULL THEN 'active'
   WHEN p_action='DECLINED' AND u.account_status='pending_approval' THEN 'declined'
   WHEN p_action='DISABLED' AND u.account_status='active' THEN 'disabled'
   WHEN p_action='REACTIVATED' AND u.account_status='disabled' THEN 'active' END;
 IF next_status IS NULL THEN RAISE EXCEPTION 'Invalid account transition'; END IF;
 IF p_action IN ('DECLINED','DISABLED') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF length(p_reason)>500 THEN RAISE EXCEPTION 'Reason too long'; END IF;
 UPDATE public.users SET account_status=next_status,status_version=status_version+1,
   status_reason=CASE WHEN p_action IN ('DECLINED','DISABLED') THEN trim(p_reason) ELSE NULL END,
   approved_at=CASE WHEN p_action='APPROVED' THEN now() ELSE approved_at END,
   approved_by=CASE WHEN p_action='APPROVED' THEN (a->>'id')::uuid ELSE approved_by END,
   disabled_at=CASE WHEN p_action='DISABLED' THEN now() ELSE disabled_at END,
   login_not_before=CASE WHEN p_action IN ('DISABLED','REACTIVATED') THEN clock_timestamp() ELSE login_not_before END
 WHERE id=u.id;
 INSERT INTO public.account_audit(target_id,actor_id,action,previous_status,resulting_status,reason)
 VALUES(u.id,(a->>'id')::uuid,p_action,u.account_status,next_status,nullif(trim(p_reason),''));
 RETURN jsonb_build_object('id',u.id,'account_status',next_status,'status_version',u.status_version+1);
END $$;

-- Lock assignment recipients against concurrent disabling; never touch unchanged history.
CREATE FUNCTION public.vt_active_participant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE field text; expected text; target uuid; i integer;
BEGIN
 FOR i IN 0..TG_NARGS-1 BY 2 LOOP
   field:=TG_ARGV[i]; expected:=TG_ARGV[i+1]; target:=(to_jsonb(NEW)->>field)::uuid;
   IF target IS NOT NULL AND (TG_OP='INSERT' OR (to_jsonb(OLD)->>field) IS DISTINCT FROM (to_jsonb(NEW)->>field)) THEN
     PERFORM 1 FROM public.users WHERE id=target AND role::text=expected AND account_status='active'
       AND (legacy_access OR phone_verified_at IS NOT NULL) FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'An active participant with the required role is needed'; END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER vt_order_participants BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.vt_active_participant('retailer_id','retailer','delivery_personnel_id','delivery_personnel');
CREATE TRIGGER vt_delivery_participants BEFORE INSERT OR UPDATE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION public.vt_active_participant('delivery_personnel_id','delivery_personnel');
CREATE TRIGGER vt_pickup_participants BEFORE INSERT OR UPDATE ON public.pickup_requests FOR EACH ROW EXECUTE FUNCTION public.vt_active_participant('farmer_id','farmer','delivery_personnel_id','delivery_personnel');
CREATE TRIGGER vt_harvest_participants BEFORE INSERT OR UPDATE ON public.harvests FOR EACH ROW EXECUTE FUNCTION public.vt_active_participant('farmer_id','farmer');

REVOKE ALL ON FUNCTION public.vt_phone(text),public.vt_sync_auth(),public.vt_account_context(uuid,uuid),public.vt_admin_transition(uuid,uuid,uuid,text,text,integer),public.vt_active_participant() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vt_account_context(uuid,uuid),public.vt_admin_transition(uuid,uuid,uuid,text,text,integer),public.vt_phone(text) TO service_role;
COMMIT;
