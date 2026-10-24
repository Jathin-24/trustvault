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