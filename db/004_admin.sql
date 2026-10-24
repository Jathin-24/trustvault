-- =============================================================================
-- TrustVault | db/004_admin.sql  (run after 003)
-- 1. admin_update_user(): role / active changes, atomic, with its own checks.
-- 2. audit_flags(): the "worth noticing" rules, as plain readable SQL.
-- =============================================================================
BEGIN;

-- An admin may change another user's role or active flag. Rules enforced HERE,
-- not only in the API route:
--   * the caller must be an active admin (re-checked inside the lock),
--   * nobody may modify themselves,
--   * all calls are serialised, so two admins demoting each other at the same
--     moment cannot leave the system with zero admins: the second caller is
--     checked AFTER the first finished, and by then is no longer an admin.
-- Because the caller is an active admin and is never the target, at least one
-- active admin always remains.
CREATE FUNCTION public.admin_update_user(
    p_actor_id  uuid,
    p_target_id uuid,
    p_role      text    DEFAULT NULL,
    p_active    boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_actor_ok boolean;
    v_t_role   text;
    v_t_active boolean;
BEGIN
    IF p_role IS NOT NULL AND p_role NOT IN ('admin', 'member') THEN
        RAISE EXCEPTION 'invalid role';
    END IF;
    IF p_role IS NULL AND p_active IS NULL THEN
        RAISE EXCEPTION 'nothing to change';
    END IF;

    PERFORM pg_advisory_xact_lock(727274002);

    SELECT true INTO v_actor_ok
      FROM public.users WHERE id = p_actor_id AND role = 'admin' AND active;
    IF v_actor_ok IS NOT TRUE THEN RAISE EXCEPTION 'not allowed'; END IF;

    IF p_target_id = p_actor_id THEN RAISE EXCEPTION 'cannot modify yourself'; END IF;

    SELECT role, active INTO v_t_role, v_t_active
      FROM public.users WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'no such user'; END IF;

    UPDATE public.users
       SET role   = COALESCE(p_role, v_t_role),
           active = COALESCE(p_active, v_t_active)
     WHERE id = p_target_id;
END;
$$;

-- "Worth noticing" rules over the last p_hours hours (default 24, max 720).
-- Counts per window, not per minute: simple, explainable, and honest.
--   repeated_denials  5+ refused attempts by one person (probing). Refused UPLOADS
--                     (bad file type etc.) are excluded: that is validation, not probing.
--   mass_download     20+ allowed downloads by one person (possible bulk copy)
--   integrity_failure any download whose stored bytes no longer matched their hash
--   admin_probe       any non-admin who tried an admin route
CREATE FUNCTION public.audit_flags(p_hours int DEFAULT 24)
RETURNS TABLE (kind text, actor_id uuid, event_count bigint, first_at timestamptz, last_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    WITH w AS (
        SELECT * FROM public.audit_log
         WHERE created_at >= now() - make_interval(hours => least(greatest(p_hours, 1), 720))
    )
    SELECT * FROM (
        SELECT 'repeated_denials'::text AS kind, a.actor_id, count(*) AS event_count, min(a.created_at) AS first_at, max(a.created_at) AS last_at
          FROM w a WHERE a.outcome = 'denied' AND a.action <> 'upload'
         GROUP BY a.actor_id HAVING count(*) >= 5
        UNION ALL
        SELECT 'mass_download', a.actor_id, count(*), min(a.created_at), max(a.created_at)
          FROM w a WHERE a.action = 'download' AND a.outcome = 'allowed'
         GROUP BY a.actor_id HAVING count(*) >= 20
        UNION ALL
        SELECT 'integrity_failure', a.actor_id, count(*), min(a.created_at), max(a.created_at)
          FROM w a WHERE a.action = 'integrity_failure'
         GROUP BY a.actor_id
        UNION ALL
        SELECT 'admin_probe', a.actor_id, count(*), min(a.created_at), max(a.created_at)
          FROM w a WHERE a.action = 'admin_access_denied'
         GROUP BY a.actor_id
    ) f
    ORDER BY f.last_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_flags(int)                             FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_flags(int)                             TO service_role;

COMMIT;