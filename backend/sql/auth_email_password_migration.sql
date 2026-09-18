-- Non-destructive migration to Supabase Auth email/password.
-- public.users.phone remains required contact information. New Auth users
-- receive their phone in signup metadata; it is not an Auth credential.
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
     VALUES(NEW.id,NEW.id,left(trim(NEW.raw_user_meta_data->>'full_name'),120),p,lower(trim(NEW.email)),requested_role::public.user_role,'pending_approval',
       left(NEW.raw_user_meta_data->>'farm_location',500),left(NEW.raw_user_meta_data->>'store_location',500),left(NEW.raw_user_meta_data->>'service_area',500),
       (NEW.raw_user_meta_data->>'latitude')::numeric,(NEW.raw_user_meta_data->>'longitude')::numeric);
   END IF;
 ELSE
   IF u.auth_user_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Missing application identity'; END IF;
   -- Existing profile phone-change verification remains a contact operation.
   IF NEW.phone IS DISTINCT FROM OLD.phone THEN
     IF NEW.phone_confirmed_at IS NULL OR u.account_status NOT IN ('active','pending_approval')
       OR nullif(OLD.phone_change,'') IS NULL OR public.vt_phone(OLD.phone_change)<>public.vt_phone(NEW.phone)
       OR nullif(OLD.phone_change_token,'') IS NULL OR nullif(NEW.phone_change,'') IS NOT NULL
       OR nullif(NEW.phone_change_token,'') IS NOT NULL THEN RAISE EXCEPTION 'Verified phone change is not allowed'; END IF;
     UPDATE public.users SET phone=public.vt_phone(NEW.phone),phone_verified_at=NEW.phone_confirmed_at WHERE id=u.id;
   END IF;
 END IF;
 RETURN NEW;
END $$;

-- Account approval and API access no longer depend on SMS confirmation.
CREATE OR REPLACE FUNCTION public.vt_account_context(p_auth_id uuid,p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; session_created timestamptz;
BEGIN
 SELECT * INTO u FROM public.users WHERE auth_user_id=p_auth_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT created_at INTO session_created FROM auth.sessions WHERE id=p_session_id AND user_id=p_auth_id;
 IF session_created IS NULL OR (u.login_not_before IS NOT NULL AND session_created<=u.login_not_before) THEN RETURN NULL; END IF;
 RETURN (to_jsonb(u)-'password_hash'-'reset_password_token'-'reset_password_expires') || jsonb_build_object('access_allowed',u.account_status='active');
END $$;

CREATE OR REPLACE FUNCTION public.vt_active_participant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE field text; expected text; target uuid; i integer;
BEGIN
 FOR i IN 0..TG_NARGS-1 BY 2 LOOP
   field:=TG_ARGV[i]; expected:=TG_ARGV[i+1]; target:=(to_jsonb(NEW)->>field)::uuid;
   IF target IS NOT NULL AND (TG_OP='INSERT' OR (to_jsonb(OLD)->>field) IS DISTINCT FROM (to_jsonb(NEW)->>field)) THEN
     PERFORM 1 FROM public.users WHERE id=target AND role::text=expected AND account_status='active' FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'An active participant with the required role is needed'; END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;

-- Approval no longer requires phone_verified_at; preserve the existing
-- distributor authorization and status transition behavior.
CREATE OR REPLACE FUNCTION public.vt_admin_transition(p_actor uuid,p_session uuid,p_target uuid,p_action text,p_reason text,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.users%ROWTYPE; a jsonb; next_status text;
BEGIN
 PERFORM 1 FROM public.users WHERE id='86d9d317-b099-430c-be21-824d0a3434b6' FOR UPDATE;
 a := public.vt_account_context(p_actor,p_session);
 IF a IS NULL OR a->>'id'<> '86d9d317-b099-430c-be21-824d0a3434b6' OR a->>'role'<>'distributor' OR NOT (a->>'access_allowed')::boolean THEN RAISE EXCEPTION 'Distributor authorization required' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM public.users WHERE id=p_target FOR UPDATE;
 IF NOT FOUND OR u.role='distributor' OR p_version IS NULL OR u.status_version<>p_version THEN RAISE EXCEPTION 'Stale or ineligible account'; END IF;
 next_status := CASE WHEN p_action='APPROVED' AND u.account_status='pending_approval' THEN 'active'
   WHEN p_action='DECLINED' AND u.account_status='pending_approval' THEN 'declined'
   WHEN p_action='DISABLED' AND u.account_status='active' THEN 'disabled'
   WHEN p_action='REACTIVATED' AND u.account_status='disabled' THEN 'active' END;
 IF next_status IS NULL THEN RAISE EXCEPTION 'Invalid account transition'; END IF;
 IF p_action IN ('DECLINED','DISABLED') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF length(p_reason)>500 THEN RAISE EXCEPTION 'Reason too long'; END IF;
 UPDATE public.users SET account_status=next_status,status_version=status_version+1,status_reason=CASE WHEN p_action IN ('DECLINED','DISABLED') THEN trim(p_reason) ELSE NULL END,
   approved_at=CASE WHEN p_action='APPROVED' THEN now() ELSE approved_at END,approved_by=CASE WHEN p_action='APPROVED' THEN (a->>'id')::uuid ELSE approved_by END,
   disabled_at=CASE WHEN p_action='DISABLED' THEN now() ELSE disabled_at END,login_not_before=CASE WHEN p_action IN ('DISABLED','REACTIVATED') THEN clock_timestamp() ELSE login_not_before END WHERE id=u.id;
 INSERT INTO public.account_audit(target_id,actor_id,action,previous_status,resulting_status,reason)
 VALUES(u.id,(a->>'id')::uuid,p_action,u.account_status,next_status,nullif(trim(p_reason),''));
 RETURN jsonb_build_object('id',u.id,'account_status',next_status,'status_version',u.status_version+1);
END $$;
COMMIT;