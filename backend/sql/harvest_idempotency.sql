-- A queued offline "add harvest" mutation may actually reach the server and
-- succeed, then appear to fail client-side (timeout, dropped connection on
-- reconnect). Without an idempotency key the client retries the same queued
-- mutation and creates a second, duplicate harvest. This does NOT restrict
-- legitimate separate harvests of the same vegetable/quantity/day — only an
-- identical client-generated request id is deduplicated.
ALTER TABLE public.harvests ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS harvests_client_request_id_key
  ON public.harvests (farmer_id, client_request_id) WHERE client_request_id IS NOT NULL;
