import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { auditAdminRead, emailsFor, pageParams, queryObject } from "@/lib/admin";
import { handleError, HttpError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

const query = z.object({ ...pageParams });

// GET /api/admin/documents   ADMIN ONLY
// Metadata about ALL documents. There is deliberately no way for an admin to read
// or download contents (decision D6): no storage_key, no download route for admins.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("admin.documents");
    const parsed = query.safeParse(queryObject(req.url));
    if (!parsed.success) throw new HttpError(400, "invalid_query");
    const p = parsed.data;
    await auditAdminRead(admin, "admin_view_documents", { page: p.page });

    const { data, error, count } = await supabaseAdmin
      .from("documents")
      .select("id, name, category, mime_type, size_bytes, owner_id, created_at, updated_at, deleted_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((p.page - 1) * p.pageSize, p.page * p.pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];

    const [emails, grants] = await Promise.all([
      emailsFor(rows.map((r) => r.owner_id)),
      rows.length
        ? supabaseAdmin.from("document_permissions").select("document_id").in("document_id", rows.map((r) => r.id)).is("revoked_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (grants.error) throw grants.error;
    const counts = new Map<string, number>();
    for (const g of grants.data ?? []) counts.set(g.document_id, (counts.get(g.document_id) ?? 0) + 1);

    return json({
      page: p.page,
      pageSize: p.pageSize,
      total: count ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        owner: { id: r.owner_id, email: emails.get(r.owner_id) ?? null },
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deletedAt: r.deleted_at,
        activeGrants: counts.get(r.id) ?? 0,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}