import { requireUser } from "@/lib/auth";
import { requireDocAccess } from "@/lib/authz";
import { handleError, json } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/documents/:id  - metadata only. Needs read access (owner, read or edit grant).
// PATCH and DELETE are added in M5, using the same requireDocAccess gate.
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const { doc, access } = await requireDocAccess({
      user,
      documentId: id,
      need: "read",
      auditAction: "view",
    });

    // Build the response field by field. NEVER spread `doc`: it holds storage_key.
    return json({
      id: doc.id,
      name: doc.name,
      category: doc.category,
      mimeType: doc.mime_type,
      sizeBytes: doc.size_bytes,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      isOwner: doc.owner_id === user.id,
      yourAccess: access,
    });
  } catch (err) {
    return handleError(err);
  }
}