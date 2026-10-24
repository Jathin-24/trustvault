import "server-only"; // build FAILS if a client component ever imports this file
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // NO "NEXT_PUBLIC_" prefix, ever

if (!url || !serviceKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check .env.local / Vercel env vars."
  );
}

/**
 * The ONLY database client in the app. It uses the service-role key, which
 * bypasses RLS, so it must only ever be used after an authorization decision
 * made in our own server code (see lib/authz.ts in M4).
 * It is a server tool, not a user session, so session handling is turned off.
 */
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});