-- =============================================================================
-- TrustVault  |  db/drop_all.sql
-- The inverse of db/schema.sql. The schema creates objects WITHOUT
-- IF NOT EXISTS, so before it can be re-run everything it creates must go.
-- Run in the SQL Editor (or via psql) as postgres.
--
-- Storage files are NOT dropped here: the storage engine blocks direct SQL
-- deletes on storage.objects / storage.buckets ("Use the Storage API
-- instead"). Remove them with the service_role key first:
--   DELETE /storage/v1/object/documents/<name>   (once per file)
--   DELETE /storage/v1/bucket/documents          (after the bucket is empty)
-- =============================================================================

BEGIN;

-- 1. Functions first: append_audit / verify_audit_chain read audit_log, and
--    CREATE FUNCTION in schema.sql fails if these still exist.
DROP FUNCTION IF EXISTS public.append_audit(uuid, text, uuid, text, text, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.verify_audit_chain()   CASCADE;
DROP FUNCTION IF EXISTS public.audit_chain_head()     CASCADE;
DROP FUNCTION IF EXISTS public.audit_row_hash(text, bigint, timestamptz, uuid, text, uuid, text, text, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at()       CASCADE;
DROP FUNCTION IF EXISTS public.audit_log_block_mutation() CASCADE;

-- 2. Tables, children before parents. Each also drops its triggers, indexes
--    and the audit_log_id_seq sequence.
DROP TABLE IF EXISTS public.document_permissions CASCADE;
DROP TABLE IF EXISTS public.audit_log            CASCADE;
DROP TABLE IF EXISTS public.documents            CASCADE;
DROP TABLE IF EXISTS public.users                CASCADE;

COMMIT;
