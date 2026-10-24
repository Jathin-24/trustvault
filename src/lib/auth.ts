import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http";

export type AppRole = "admin" | "member";

/** The small object the rest of the app works with. Never the raw DB row. */
export type AppUser = {
  id: string; // OUR users.id (uuid), not the Clerk id
  email: string;
  name: string | null;
  role: AppRole;
};

type UserRow = AppUser & { active: boolean };

async function findByClerkId(clerkId: string): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, email, name, role, active")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  if (error) throw error;
  return (data as UserRow | null) ?? null;
}

/**
 * First sign-in only: create our row for a Clerk user ("lazy sync").
 *
 * - Email must be Clerk's PRIMARY address AND verified. Otherwise an attacker
 *   could sign up with a victim's address and receive grants meant for them.
 * - role/active are never sent, so the DB defaults apply (member, active).
 * - ON CONFLICT DO NOTHING (ignoreDuplicates): three simultaneous first
 *   requests create exactly one row, and an existing row is NEVER overwritten,
 *   so a sign-in can't reset an admin to member or re-activate a disabled user.
 */
async function provisionUser(clerkId: string): Promise<void> {
  const cu = await currentUser();
  if (!cu || cu.id !== clerkId) throw new HttpError(401, "unauthorized");

  const primary = cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") {
    throw new HttpError(403, "email_not_verified");
  }

  const { error } = await supabaseAdmin.from("users").upsert(
    {
      clerk_id: clerkId,
      email: primary.emailAddress.toLowerCase(),
      name: cu.fullName ?? cu.username ?? null,
    },
    { onConflict: "clerk_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}

/**
 * Who is making this request?
 *   null            -> not signed in
 *   throws 403      -> signed in with Clerk, but disabled in OUR database
 *   AppUser         -> signed in and allowed
 *
 * The role and the active flag come ONLY from our database, on every request.
 * Nothing the client sends (headers, cookies, body) can change either.
 * That is what makes "deactivate" and "change role" take effect immediately.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  let row = await findByClerkId(userId);
  if (!row) {
    await provisionUser(userId);
    row = await findByClerkId(userId);
    if (!row) throw new Error("user row missing right after provisioning");
  }

  if (!row.active) {
    // Known actor, so this is worth recording. Even if the audit write fails,
    // the user is still blocked.
    try {
      await logAudit({ actorId: row.id, action: "login_blocked", outcome: "denied" });
    } catch (e) {
      console.error("could not audit login_blocked:", e);
    }
    throw new HttpError(403, "account_disabled");
  }

  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Use at the top of every API route that needs a signed-in user. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "unauthorized");
  return user;
}

/**
 * Admin-only routes. `route` is just a label for the audit trail.
 * A non-admin attempt is recorded as a denied event, then refused.
 */
export async function requireAdmin(route: string): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    try {
      await logAudit({
        actorId: user.id,
        action: "admin_access_denied",
        outcome: "denied",
        details: { route },
      });
    } catch (e) {
      console.error("could not audit admin_access_denied:", e);
    }
    throw new HttpError(403, "forbidden");
  }
  return user;
}