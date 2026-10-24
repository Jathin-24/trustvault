import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { auditAdminRead, docNamesFor, emailsFor, pageParams, queryObject, UUID } from "@/lib/admin";
import { handleError, HttpError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

const query = z.object({
  actor: UUID.optional(),
  document: UUID.optional(),
  action: z.string().regex(/^[a-z_]{1,64}$/).optional(),
  outcome: z.enum(["allowed", "denied"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ...pageParams,
});

// GET /api/admin/audit?actor=&document=&action=&outcome=&from=&to=&page=&pageSize=   ADMIN ONLY
// Use action=grant or action=revoke for "permission changes".
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("admin.audit");
    const parsed = query.safeParse(queryObject(req.url));
    if (!parsed.success) throw new HttpError(400, "invalid_query");
    const p = parsed.data;

    const from = p.from ? new Date(`${p.from}T00:00:00Z`) : null;
    const to = p.to ? new Date(Date.parse(`${p.to}T00:00:00Z`) + 86_400_000) : null;
    if ((from && isNaN(+from)) || (to && isNaN(+to))) throw new HttpError(400, "invalid_query");

    await auditAdminRead(admin, "admin_view_audit", { filters: parsed.data });

    let q = supabaseAdmin
      .from("audit_log")
      .select("id, created_at, actor_id, action, document_id, outcome, ip, user_agent, details, hash", { count: "exact" })
      .order("id", { ascending: false })
      .range((p.page - 1) * p.pageSize, p.page * p.pageSize - 1);
    if (p.actor) q = q.eq("actor_id", p.actor);
    if (p.document) q = q.eq("document_id", p.document);
    if (p.action) q = q.eq("action", p.action);
    if (p.outcome) q = q.eq("outcome", p.outcome);
    if (from) q = q.gte("created_at", from.toISOString());
    if (to) q = q.lt("created_at", to.toISOString());

    const { data, error, count } = await q;
    if (error) throw error;
    const rows = data ?? [];

    const [emails, docs] = await Promise.all([
      emailsFor(rows.map((r) => r.actor_id)),
      docNamesFor(rows.map((r) => r.document_id)),
    ]);

    return json({
      page: p.page,
      pageSize: p.pageSize,
      total: count ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        at: r.created_at,
        actor: r.actor_id ? { id: r.actor_id, email: emails.get(r.actor_id) ?? null } : null,
        action: r.action,
        outcome: r.outcome,
        document: r.document_id ? { id: r.document_id, name: docs.get(r.document_id) ?? null } : null,
        ip: r.ip,
        userAgent: r.user_agent,
        details: r.details,
        hash: r.hash,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}