-- VeggieTrack: recent received-batch photo and distributor account guard.
-- Run once after fifo_inventory_upgrade.sql and auth_supabase_migration.sql.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS batch_photo_url text;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_batch_photo_url_format;
ALTER TABLE public.products ADD CONSTRAINT products_batch_photo_url_format CHECK (
  batch_photo_url IS NULL OR (
    length(batch_photo_url) <= 2048
    AND batch_photo_url ~ '^https://res[.]cloudinary[.]com/[A-Za-z0-9_-]+/image/upload/v[0-9]+/[A-Za-z0-9_./-]+$'
    AND position('..' in batch_photo_url) = 0
  )
);

-- The distributor is the administrator account. Keep it active even if a
-- service-role caller or future endpoint attempts a direct status update.
UPDATE public.users SET account_status = 'active', disabled_at = NULL, status_reason = NULL
WHERE role = 'distributor' AND account_status <> 'active';

CREATE OR REPLACE FUNCTION public.vt_protect_distributor_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.role = 'distributor' AND NEW.account_status <> 'active' THEN
    RAISE EXCEPTION 'Distributor account must remain active';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vt_protect_distributor_account ON public.users;
CREATE TRIGGER vt_protect_distributor_account
BEFORE UPDATE OF account_status ON public.users
FOR EACH ROW EXECUTE FUNCTION public.vt_protect_distributor_account();

REVOKE ALL ON FUNCTION public.vt_protect_distributor_account() FROM PUBLIC, anon, authenticated;
