-- =============================================================================
-- TrustVault  |  db/schema.sql
-- Target: a FRESH Supabase (PostgreSQL 15+) project. Run in the SQL Editor.
-- Runs as one transaction: if anything fails, nothing is created.
--
-- SECURITY MODEL (read this before the interview)
--   1. The browser never talks to the database. Only server code, using the
--      service_role key, does.
--   2. RLS is ON for every table with NO policies, and table privileges are
--      revoked from anon/authenticated. Two locks: if one is misconfigured
--      later, the other still holds.
--   3. The audit log can only be appended to, through append_audit().
--      UPDATE / DELETE / TRUNCATE are blocked by triggers, and no role except
--      the function owner can INSERT.
--   4. Every audit row is hash-chained to the previous one, so any change to a
--      retained row is detectable with verify_audit_chain().
--
-- KNOWN LIMITS (also listed in THREATS.md)
--   * Deleting the TAIL of the log leaves a valid-looking chain. Mitigation:
--     record audit_chain_head() somewhere outside the database.
--   * A database owner / superuser can disable triggers and rewrite the whole
--     chain. That is outside this application's threat model.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Application tables (order matters: referenced tables first)
-- -----------------------------------------------------------------------------

CREATE TABLE public.users (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id    text        NOT NULL UNIQUE,              -- link to the Clerk user
    email       text        NOT NULL,
    name        text,
    role        text        NOT NULL DEFAULT 'member'     -- never default to admin
                            CHECK (role IN ('admin', 'member')),
    active      boolean     NOT NULL DEFAULT true,        -- false = locked out at once
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.documents (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid        NOT NULL REFERENCES public.users(id),
    name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    category    text        NOT NULL DEFAULT 'general'
                            CHECK (char_length(category) BETWEEN 1 AND 50),
    storage_key text        NOT NULL UNIQUE,              -- random UUID, never the user's filename
    mime_type   text        NOT NULL
                            CHECK (mime_type IN (
                                'application/pdf',
                                'image/png',
                                'image/jpeg',
                                'text/plain',
                                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                            )),
    size_bytes  bigint      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304), -- 4 MB (D4)
    sha256      text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz                               -- NULL = not deleted (soft delete, D9)
);

CREATE TABLE public.document_permissions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid        NOT NULL REFERENCES public.documents(id),
    user_id     uuid        NOT NULL REFERENCES public.users(id),
    level       text        NOT NULL CHECK (level IN ('read', 'edit')),
    granted_by  uuid        NOT NULL REFERENCES public.users(id),
    granted_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz                               -- NULL = grant is active
);

-- At most ONE active grant per (document, user). Without this, a double-click
-- could create two grants, a revoke would close only one, and the user would
-- keep access you believed was removed. Revoked rows stay as history.
CREATE UNIQUE INDEX document_permissions_one_active_grant_uq
    ON public.document_permissions (document_id, user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX documents_owner_id_idx            ON public.documents (owner_id);
CREATE INDEX documents_category_idx            ON public.documents (category);
CREATE INDEX documents_created_at_idx          ON public.documents (created_at);
CREATE INDEX document_permissions_user_id_idx  ON public.document_permissions (user_id);
CREATE INDEX document_permissions_doc_id_idx   ON public.document_permissions (document_id);

-- Keep documents.updated_at honest without trusting application code.
CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER documents_set_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- B. Audit table
-- -----------------------------------------------------------------------------
-- No foreign keys on purpose: audit rows must be writable even for unknown
-- users or missing documents (e.g. a denied attempt on a guessed id), and a
-- foreign key would also block deleting users/documents later.

CREATE TABLE public.audit_log (
    id          bigserial   PRIMARY KEY,                  -- defines chain order
    created_at  timestamptz NOT NULL,
    actor_id    uuid,
    action      text        NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
    document_id uuid,
    outcome     text        NOT NULL CHECK (outcome IN ('allowed', 'denied')),
    ip          text,
    user_agent  text,
    details     jsonb,
    prev_hash   text        NOT NULL,
    hash        text        NOT NULL
);

CREATE INDEX audit_log_created_at_idx  ON public.audit_log (created_at);
CREATE INDEX audit_log_document_id_idx ON public.audit_log (document_id);
CREATE INDEX audit_log_actor_id_idx    ON public.audit_log (actor_id);

-- -----------------------------------------------------------------------------
-- C. Protection 1: append-only (blocks edits)
-- -----------------------------------------------------------------------------
-- Row triggers do NOT fire on TRUNCATE, so TRUNCATE needs its own trigger.

CREATE FUNCTION public.audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON public.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_block_mutation();

-- -----------------------------------------------------------------------------
-- D. Protection 2: hash chain (makes any change DETECTABLE)
-- -----------------------------------------------------------------------------
-- One helper computes the hash, used by BOTH append_audit() and the verifier,
-- so they can never disagree.
--  * Fields go into a JSON array before hashing: delimiter characters inside
--    user-controlled text (ip, user agent, details) cannot create ambiguity.
--  * Time is hashed as epoch text, so it does not depend on session timezone.
--  * NULLs become JSON null instead of silently nulling the whole hash.

CREATE FUNCTION public.audit_row_hash(
    p_prev_hash   text,
    p_id          bigint,
    p_created_at  timestamptz,
    p_actor_id    uuid,
    p_action      text,
    p_document_id uuid,
    p_outcome     text,
    p_ip          text,
    p_user_agent  text,
    p_details     jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT encode(
        sha256(
            convert_to(
                jsonb_build_array(
                    p_prev_hash,
                    p_id,
                    extract(epoch FROM p_created_at)::text,
                    p_actor_id,
                    p_action,
                    p_document_id,
                    p_outcome,
                    p_ip,
                    p_user_agent,
                    p_details
                )::text,
                'UTF8'
            )
        ),
        'hex'
    );
$$;

-- The ONLY way to add an audit row.
-- SECURITY DEFINER: runs with the owner's rights, so callers need no INSERT
-- privilege on audit_log. search_path is pinned to stop search-path hijacking.
CREATE FUNCTION public.append_audit(
    p_actor_id    uuid,
    p_action      text,
    p_document_id uuid,
    p_outcome     text,
    p_ip          text,
    p_user_agent  text,
    p_details     jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_prev  text;
    v_id    bigint;
    v_now   timestamptz;
    v_hash  text;
    v_ip    text := left(p_ip, 64);
    v_ua    text := left(p_user_agent, 512);
BEGIN
    -- 1. Serialise writers. Without this, two simultaneous requests could read
    --    the same "last hash" and fork the chain. The lock is released
    --    automatically when the transaction ends.
    PERFORM pg_advisory_xact_lock(727274001);

    -- 2. Previous hash (64 zeros for the very first row).
    SELECT a.hash INTO v_prev
      FROM public.audit_log a
     ORDER BY a.id DESC
     LIMIT 1;
    v_prev := COALESCE(v_prev, repeat('0', 64));

    -- 3. Id and time are fixed here so the hash covers exactly what is stored.
    v_id  := nextval(pg_get_serial_sequence('public.audit_log', 'id'));
    v_now := clock_timestamp();

    v_hash := public.audit_row_hash(
        v_prev, v_id, v_now, p_actor_id, p_action,
        p_document_id, p_outcome, v_ip, v_ua, p_details
    );

    INSERT INTO public.audit_log
        (id, created_at, actor_id, action, document_id, outcome,
         ip, user_agent, details, prev_hash, hash)
    VALUES
        (v_id, v_now, p_actor_id, p_action, p_document_id, p_outcome,
         v_ip, v_ua, p_details, v_prev, v_hash);

    RETURN v_id;
END;
$$;

-- Returns the id of the FIRST row that fails verification, or NULL if the
-- retained chain is intact.
CREATE FUNCTION public.verify_audit_chain()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    r             public.audit_log%ROWTYPE;
    v_expect_prev text := repeat('0', 64);
BEGIN
    FOR r IN SELECT * FROM public.audit_log ORDER BY id LOOP
        IF r.prev_hash IS DISTINCT FROM v_expect_prev THEN
            RETURN r.id;
        END IF;

        IF r.hash IS DISTINCT FROM public.audit_row_hash(
               r.prev_hash, r.id, r.created_at, r.actor_id, r.action,
               r.document_id, r.outcome, r.ip, r.user_agent, r.details) THEN
            RETURN r.id;
        END IF;

        v_expect_prev := r.hash;
    END LOOP;

    RETURN NULL;
END;
$$;

-- The head of the chain. Save this value OUTSIDE the database (e.g. in your
-- notes or repo) from time to time; it is the anchor that makes tail deletion
-- detectable.
CREATE FUNCTION public.audit_chain_head()
RETURNS TABLE (last_id bigint, last_hash text, row_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        (SELECT a.id   FROM public.audit_log a ORDER BY a.id DESC LIMIT 1),
        (SELECT a.hash FROM public.audit_log a ORDER BY a.id DESC LIMIT 1),
        (SELECT count(*) FROM public.audit_log);
$$;

-- -----------------------------------------------------------------------------
-- E. Locking everything down
-- -----------------------------------------------------------------------------
-- E1. RLS on, no policies: the public anon key sees nothing.
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;

-- E2. Second lock: no table privileges for browser-facing roles at all.
--     Supabase grants these by default, so they must be revoked explicitly.
REVOKE ALL ON public.users                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.documents            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.document_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_log            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq
                                          FROM PUBLIC, anon, authenticated, service_role;

-- E3. The server (service_role) gets what it needs and nothing more.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users, public.documents,
                                        public.document_permissions TO service_role;
GRANT SELECT ON public.audit_log TO service_role;    -- read for the admin page; no writes

-- E4. Functions are callable from the API (/rest/v1/rpc/...) by default.
--     Without these revokes anyone holding the public anon key could forge
--     audit entries.
REVOKE ALL ON FUNCTION public.append_audit(uuid, text, uuid, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_audit_chain()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_chain_head()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_row_hash(text, bigint, timestamptz, uuid, text, uuid, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_log_block_mutation()  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_audit(uuid, text, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_chain_head()   TO service_role;

-- -----------------------------------------------------------------------------
-- F. Private storage bucket
-- -----------------------------------------------------------------------------
-- public = false, and NO policies on storage.objects: only the server
-- (service_role) can read or write files. Downloads are streamed by the
-- server after an authorization check, so there are no URLs to outlive a
-- revocation.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents', 'documents', false, 4194304,
    ARRAY[
        'application/pdf',
        'image/png',
        'image/jpeg',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;

-- =============================================================================
-- TrustVault | db/002_search_documents.sql  (run after schema.sql)
-- 1. Unique email (grants are made by email: two users must never share one).
-- 2. search_documents(): list + search with the ACCESS FILTER INSIDE the query.
--    A document is returned only if it is not deleted AND the caller is its
--    owner or holds an ACTIVE grant. Everything the caller typed is a bound
--    parameter, never concatenated into SQL.
-- =============================================================================
BEGIN;

CREATE UNIQUE INDEX users_email_lower_uq ON public.users (lower(email));

CREATE FUNCTION public.search_documents(
    p_user_id  uuid,
    p_q        text        DEFAULT NULL,
    p_owner    text        DEFAULT NULL,
    p_category text        DEFAULT NULL,
    p_from     timestamptz DEFAULT NULL,   -- inclusive
    p_to       timestamptz DEFAULT NULL,   -- exclusive
    p_limit    int         DEFAULT 20,
    p_offset   int         DEFAULT 0
)
RETURNS TABLE (
    id          uuid,
    name        text,
    category    text,
    mime_type   text,
    size_bytes  bigint,
    created_at  timestamptz,
    updated_at  timestamptz,
    owner_id    uuid,
    owner_name  text,
    owner_email text,
    your_access text,
    total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT d.id, d.name, d.category, d.mime_type, d.size_bytes,
           d.created_at, d.updated_at,
           d.owner_id, u.name, u.email,
           CASE WHEN d.owner_id = p_user_id THEN 'owner' ELSE g.level END,
           count(*) OVER ()
      FROM public.documents d
      JOIN public.users u ON u.id = d.owner_id
      LEFT JOIN public.document_permissions g
             ON g.document_id = d.id
            AND g.user_id = p_user_id
            AND g.revoked_at IS NULL
     WHERE d.deleted_at IS NULL
       AND (d.owner_id = p_user_id OR g.id IS NOT NULL)          -- THE access filter
       AND (p_q        IS NULL OR d.name ILIKE '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (p_owner    IS NULL OR u.email ILIKE '%' || replace(replace(replace(p_owner, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                               OR u.name  ILIKE '%' || replace(replace(replace(p_owner, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (p_category IS NULL OR lower(d.category) = lower(p_category))
       AND (p_from     IS NULL OR d.created_at >= p_from)
       AND (p_to       IS NULL OR d.created_at <  p_to)
     ORDER BY d.created_at DESC, d.id
     LIMIT least(greatest(p_limit, 1), 100)
    OFFSET greatest(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.search_documents(uuid, text, text, text, timestamptz, timestamptz, int, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_documents(uuid, text, text, text, timestamptz, timestamptz, int, int)
    TO service_role;

COMMIT;

-- =============================================================================
-- TrustVault | db/003_permissions.sql  (run after 002)
-- Atomic grant / revoke. Each is ONE database transaction, so a half-finished
-- change (old grant closed, new one missing, or two active grants) cannot exist.
-- Both functions re-check the owner rule themselves: even if the API route had
-- a bug, the database refuses a grant not made by the document's owner.
-- =============================================================================
BEGIN;

-- Emails are stored lowercase, so lookups can use plain equality. (ILIKE would
-- treat "_" in an address as a wildcard and could match the WRONG person.)
UPDATE public.users SET email = lower(email) WHERE email <> lower(email);
ALTER TABLE public.users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

CREATE FUNCTION public.grant_document_access(
    p_document_id uuid,
    p_user_id     uuid,
    p_level       text,
    p_granted_by  uuid
)
RETURNS TABLE (permission_id uuid, changed boolean, previous_level text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_owner     uuid;
    v_old_id    uuid;
    v_old_level text;
    v_new_id    uuid;
BEGIN
    IF p_level NOT IN ('read', 'edit') THEN
        RAISE EXCEPTION 'invalid level';
    END IF;

    -- Only the owner of a live document may grant.
    SELECT d.owner_id INTO v_owner
      FROM public.documents d
     WHERE d.id = p_document_id AND d.deleted_at IS NULL;
    IF v_owner IS NULL OR v_owner <> p_granted_by THEN
        RAISE EXCEPTION 'not allowed';
    END IF;
    IF p_user_id = v_owner THEN
        RAISE EXCEPTION 'owner already has full access';
    END IF;

    -- Serialise concurrent grants for the same (document, user).
    PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id::text || ':' || p_user_id::text, 0));

    SELECT g.id, g.level INTO v_old_id, v_old_level
      FROM public.document_permissions g
     WHERE g.document_id = p_document_id AND g.user_id = p_user_id AND g.revoked_at IS NULL;

    IF v_old_id IS NOT NULL THEN
        IF v_old_level = p_level THEN
            RETURN QUERY SELECT v_old_id, false, v_old_level;   -- nothing to change
            RETURN;
        END IF;
        -- Level change = close the old grant, open a new one (history stays honest).
        UPDATE public.document_permissions SET revoked_at = now() WHERE id = v_old_id;
    END IF;

    INSERT INTO public.document_permissions (document_id, user_id, level, granted_by)
    VALUES (p_document_id, p_user_id, p_level, p_granted_by)
    RETURNING id INTO v_new_id;

    RETURN QUERY SELECT v_new_id, true, v_old_level;
END;
$$;

CREATE FUNCTION public.revoke_document_access(
    p_document_id   uuid,
    p_permission_id uuid,
    p_revoked_by    uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_owner uuid;
    v_rows  int;
BEGIN
    SELECT d.owner_id INTO v_owner
      FROM public.documents d
     WHERE d.id = p_document_id;                 -- a deleted document's grants may still be closed
    IF v_owner IS NULL OR v_owner <> p_revoked_by THEN
        RAISE EXCEPTION 'not allowed';
    END IF;

    UPDATE public.document_permissions
       SET revoked_at = now()
     WHERE id = p_permission_id
       AND document_id = p_document_id           -- the grant must belong to THIS document
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_document_access(uuid, uuid, text, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_document_access(uuid, uuid, uuid)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_document_access(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_document_access(uuid, uuid, uuid)      TO service_role;

COMMIT;