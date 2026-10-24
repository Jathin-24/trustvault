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