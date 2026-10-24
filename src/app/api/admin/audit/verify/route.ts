import { requireAdmin } from "@/lib/auth";
import { auditAdminRead } from "@/lib/admin";
import { handleError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/admin/audit/verify   ADMIN ONLY
// Recomputes the whole hash chain. `intact: false` names the first row that no
// longer matches. Also returns the chain head: copy it somewhere OUTSIDE the
// database now and then; that is what makes deleting the newest rows detectable.
export async function GET() {
  try {
    const admin = await requireAdmin("admin.audit.verify");

    const [verify, head] = await Promise.all([
      supabaseAdmin.rpc("verify_audit_chain"),
      supabaseAdmin.rpc("audit_chain_head"),
    ]);
    if (verify.error) throw verify.error;
    if (head.error) throw head.error;

    const firstBadId = (verify.data as number | null) ?? null;
    const h = ((head.data ?? []) as { last_id: number | null; last_hash: string | null; row_count: number | string }[])[0];

    await auditAdminRead(admin, "admin_verify_chain", { intact: firstBadId === null, first_bad_id: firstBadId });

    return json({
      intact: firstBadId === null,
      firstBadId,
      head: { lastId: h?.last_id ?? null, lastHash: h?.last_hash ?? null, rowCount: Number(h?.row_count ?? 0) },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}