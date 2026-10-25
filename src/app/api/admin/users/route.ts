import { requireAdmin } from "@/lib/auth";
import { auditAdminRead } from "@/lib/admin";
import { handleError, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/admin/users   ADMIN ONLY
export async function GET() {
  try {
    const admin = await requireAdmin("admin.users");
    await auditAdminRead(admin, "admin_view_users");

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, email, name, role, active, upload_enabled, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    return json({
      items: (data ?? []).map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, uploadEnabled: u.upload_enabled, createdAt: u.created_at,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}