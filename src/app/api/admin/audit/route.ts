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

    // See documents/route.ts: JS rolls impossible days ("2026-02-30") over to
    // the next month, so each date is round-tripped and refused unless it is a
    // real calendar day. (Found by the M9 attack run.)
    const parseDay = (s: string) => {
      const d = new Date(`${s}T00:00:00Z`);
      return isNaN(+d) || d.toISOString().slice(0, 10) !== s ? null : d;
    };
    const from = p.from ? parseDay(p.from) : null;
    const to = p.to ? parseDay(p.to) : null;
    if ((p.from && !from) || (p.to && !to)) throw new HttpError(400, "invalid_query");
    const toEnd = to ? new Date(+to + 86_400_000) : null; // inclusive day

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
    if (toEnd) q = q.lt("created_at", toEnd.toISOString());

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