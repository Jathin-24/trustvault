import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireDocAccess } from "@/lib/authz";
import { assertSameOrigin, handleError, HttpError, json, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

type GrantRow = {
  id: string; user_id: string; level: "read" | "edit";
  granted_by: string; granted_at: string; revoked_at: string | null;
};

// GET /api/documents/:id/permissions[?history=1]  - OWNER ONLY.
// Lists who currently has access (history=1 also shows revoked grants).
export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "share", // owner only
      auditAction: "list_permissions",
    });

    const history = new URL(req.url).searchParams.get("history") === "1";
    let query = supabaseAdmin
      .from("document_permissions")
      .select("id, user_id, level, granted_by, granted_at, revoked_at")
      .eq("document_id", doc.id)
      .order("granted_at", { ascending: false })
      .limit(500);
    if (!history) query = query.is("revoked_at", null);

    const { data, error } = await query;
    if (error) throw error;
    const grants = (data ?? []) as GrantRow[];

    // Names/emails of the people involved (grantees and granters).
    const ids = [...new Set(grants.flatMap((g) => [g.user_id, g.granted_by]))];
    const people = new Map<string, { email: string; name: string | null }>();
    if (ids.length) {
      const res = await supabaseAdmin.from("users").select("id, email, name").in("id", ids);
      if (res.error) throw res.error;
      for (const p of res.data ?? []) people.set(p.id, { email: p.email, name: p.name });
    }

    return json({
      items: grants.map((g) => ({
        id: g.id,
        level: g.level,
        user: people.get(g.user_id) ?? null,
        grantedBy: people.get(g.granted_by)?.email ?? null,
        grantedAt: g.granted_at,
        revokedAt: g.revoked_at,
        active: g.revoked_at === null,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

const grantBody = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  level: z.enum(["read", "edit"]),
});

// POST /api/documents/:id/permissions  { email, level }  - OWNER ONLY.
// Grants (or changes the level of) one named person's access.
// A named person must already have signed in once (they need an account).
export async function POST(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;

    const parsed = grantBody.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "invalid_body");
    const { email, level } = parsed.data;

    // Authorize BEFORE looking the person up. Otherwise a stranger could use this
    // route to discover which email addresses have accounts.
    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "share", // owner only; edit-holders can never re-share
      auditAction: "grant",
      details: { target_email: email, level },
    });

    const target = await supabaseAdmin
      .from("users")
      .select("id, email, name, active")
      .eq("email", email) // emails are stored lowercase (DB constraint)
      .maybeSingle();
    if (target.error) throw target.error;
    if (!target.data || !target.data.active) throw new HttpError(404, "user_not_found");
    if (target.data.id === doc.owner_id) throw new HttpError(400, "owner_already_has_access");

    const { data, error } = await supabaseAdmin.rpc("grant_document_access", {
      p_document_id: doc.id,
      p_user_id: target.data.id,
      p_level: level,
      p_granted_by: user.id,
    });
    if (error) throw error;
    const row = (data as { permission_id: string; changed: boolean; previous_level: string | null }[])[0];

    return json(
      {
        permissionId: row.permission_id,
        changed: row.changed,
        previousLevel: row.previous_level,
        level,
        user: { email: target.data.email, name: target.data.name },
      },
      row.changed ? 201 : 200
    );
  } catch (err) {
    return handleError(err);
  }
}