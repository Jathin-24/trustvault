import { requireUser } from "@/lib/auth";
import { requireDocAccess } from "@/lib/authz";
import { assertSameOrigin, handleError, HttpError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string; permId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/documents/:id/permissions/:permId  - OWNER ONLY.
// Revokes one grant. It takes effect on the very next request, because every
// request re-reads grants from the database and nothing long-lived was issued
// (no signed URLs, no tokens).
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id, permId } = await ctx.params;

    // Look up who the grant is for, ONLY to enrich the audit record. The result is
    // never returned to the caller, so it cannot be used to probe other documents.
    let target: { user_id: string; level: string } | null = null;
    if (UUID_RE.test(permId) && UUID_RE.test(id)) {
      const res = await supabaseAdmin
        .from("document_permissions")
        .select("user_id, level")
        .eq("id", permId)
        .eq("document_id", id)
        .maybeSingle();
      if (res.error) throw res.error;
      target = res.data;
    }

    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "share", // owner only
      auditAction: "revoke",
      details: { permission_id: permId.slice(0, 64), target_user_id: target?.user_id ?? null, level: target?.level ?? null },
    });

    if (!UUID_RE.test(permId)) throw new HttpError(404, "not_found");

    const { data, error } = await supabaseAdmin.rpc("revoke_document_access", {
      p_document_id: doc.id,
      p_permission_id: permId,
      p_revoked_by: user.id,
    });
    if (error) throw error;
    if (data !== true) throw new HttpError(404, "not_found"); // unknown, other document's, or already revoked

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}