import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { auditAdminRead, docNamesFor, emailsFor, pageParams, queryObject } from "@/lib/admin";
import { handleError, HttpError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

const query = z.object({ ...pageParams });

// GET /api/admin/permissions   ADMIN ONLY
// Every grant ever made, newest first: who gave whom which access to what, and
// when it was revoked. This is the authoritative state; /api/admin/audit?action=grant
// shows the matching event trail.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("admin.permissions");
    const parsed = query.safeParse(queryObject(req.url));
    if (!parsed.success) throw new HttpError(400, "invalid_query");
    const p = parsed.data;
    await auditAdminRead(admin, "admin_view_permissions", { page: p.page });

    const { data, error, count } = await supabaseAdmin
      .from("document_permissions")
      .select("id, document_id, user_id, level, granted_by, granted_at, revoked_at", { count: "exact" })
      .order("granted_at", { ascending: false })
      .range((p.page - 1) * p.pageSize, p.page * p.pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];

    const [emails, docs] = await Promise.all([
      emailsFor(rows.flatMap((r) => [r.user_id, r.granted_by])),
      docNamesFor(rows.map((r) => r.document_id)),
    ]);

    return json({
      page: p.page,
      pageSize: p.pageSize,
      total: count ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        document: { id: r.document_id, name: docs.get(r.document_id) ?? null },
        user: emails.get(r.user_id) ?? null,
        level: r.level,
        grantedBy: emails.get(r.granted_by) ?? null,
        grantedAt: r.granted_at,
        revokedAt: r.revoked_at,
        active: r.revoked_at === null,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}