-- Idempotency key for offline harvest submissions: a retried request with the
-- same client-generated id is not inserted twice. Separate harvests of the same
-- vegetable are unaffected.
ALTER TABLE public.harvests ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS harvests_client_request_id_key
  ON public.harvests (farmer_id, client_request_id) WHERE client_request_id IS NOT NULL;
