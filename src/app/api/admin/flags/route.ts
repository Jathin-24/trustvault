import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { auditAdminRead, emailsFor, queryObject } from "@/lib/admin";
import { handleError, HttpError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

const query = z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) });

// GET /api/admin/flags?hours=24   ADMIN ONLY
// "Worth noticing" events. The rules live in the audit_flags() SQL function.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("admin.flags");
    const parsed = query.safeParse(queryObject(req.url));
    if (!parsed.success) throw new HttpError(400, "invalid_query");
    await auditAdminRead(admin, "admin_view_flags", { hours: parsed.data.hours });

    const { data, error } = await supabaseAdmin.rpc("audit_flags", { p_hours: parsed.data.hours });
    if (error) throw error;
    const rows = (data ?? []) as { kind: string; actor_id: string | null; event_count: number | string; first_at: string; last_at: string }[];
    const emails = await emailsFor(rows.map((r) => r.actor_id));

    return json({
      hours: parsed.data.hours,
      items: rows.map((r) => ({
        kind: r.kind,
        actor: r.actor_id ? { id: r.actor_id, email: emails.get(r.actor_id) ?? null } : null,
        count: Number(r.event_count),
        firstAt: r.first_at,
        lastAt: r.last_at,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}