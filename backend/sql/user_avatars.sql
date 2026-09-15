-- Chunk 1: existing-account avatars. Apply after auth_supabase_migration.sql.
-- New-user signup requirements belong to Chunk 4; legacy avatars stay nullable.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.vt_account_context(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply the Supabase Auth migration before user_avatars.sql';
  END IF;
END $$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at timestamptz;

ALTER TABLE public.users ADD CONSTRAINT users_avatar_url_format CHECK (
  avatar_url IS NULL OR (
    length(avatar_url) <= 2048
    AND avatar_url ~ '^https://res[.]cloudinary[.]com/[A-Za-z0-9_-]+/image/upload/v[0-9]+/[A-Za-z0-9_./-]+$'
    AND position('..' in avatar_url) = 0
  )
);

CREATE FUNCTION public.vt_stamp_avatar() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.profile_picture_updated_at := CASE WHEN NEW.avatar_url IS NOT NULL
      THEN clock_timestamp() ELSE NULL END;
  ELSIF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    NEW.profile_picture_updated_at := clock_timestamp();
  ELSE
    NEW.profile_picture_updated_at := OLD.profile_picture_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vt_stamp_avatar BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.vt_stamp_avatar();

REVOKE ALL ON FUNCTION public.vt_stamp_avatar() FROM PUBLIC, anon, authenticated;
REVOKE ALL (avatar_url, profile_picture_updated_at) ON public.users
FROM PUBLIC, anon, authenticated;
-- Existing API service-role table grants and restrictive RLS remain unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
