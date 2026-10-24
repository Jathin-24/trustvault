import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertSameOrigin, handleError, HttpError, json, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ userId: string }> };

const body = z
  .strictObject({ role: z.enum(["admin", "member"]).optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined);

// PATCH /api/admin/users/:userId  { role?, active? }   ADMIN ONLY
// Deactivating takes effect on that person's very next request (getCurrentUser
// checks `active` in our database every time). Admins cannot modify themselves.
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin("admin.users.update");
    const { userId } = await ctx.params;

    const parsed = body.safeParse(await readJson(req));
    if (!parsed.success || !z.string().uuid().safeParse(userId).success) throw new HttpError(400, "invalid_request");
    if (userId === admin.id) throw new HttpError(400, "cannot_modify_self");

    const found = await supabaseAdmin.from("users").select("id, email, role, active").eq("id", userId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) throw new HttpError(404, "not_found");
    const t = found.data as { id: string; email: string; role: string; active: boolean };

    const events: { action: string; from: unknown; to: unknown }[] = [];
    if (parsed.data.role !== undefined && parsed.data.role !== t.role)
      events.push({ action: "role_change", from: t.role, to: parsed.data.role });
    if (parsed.data.active !== undefined && parsed.data.active !== t.active)
      events.push({ action: parsed.data.active ? "user_activate" : "user_deactivate", from: t.active, to: parsed.data.active });
    if (!events.length) return json({ changed: false });

    // Audit FIRST (fails closed): no record, no change.
    for (const e of events) {
      await logAudit({
        actorId: admin.id,
        action: e.action,
        outcome: "allowed",
        details: { target_id: t.id, target_email: t.email, from: e.from, to: e.to },
      });
    }

    const { error } = await supabaseAdmin.rpc("admin_update_user", {
      p_actor_id: admin.id,
      p_target_id: t.id,
      p_role: parsed.data.role ?? null,
      p_active: parsed.data.active ?? null,
    });
    if (error) {
      console.error("admin_update_user refused:", error.message);
      try {
        await logAudit({ actorId: admin.id, action: "user_update_refused", outcome: "denied", details: { target_id: t.id, reason: error.message } });
      } catch (e) {
        console.error("could not audit refusal:", e);
      }
      throw new HttpError(409, "conflict");
    }

    return json({ changed: true });
  } catch (err) {
    return handleError(err);
  }
}