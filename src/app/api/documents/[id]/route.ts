import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireDocAccess } from "@/lib/authz";
import { assertSameOrigin, handleError, HttpError, json, readJson } from "@/lib/http";
import { ALLOWED_TYPES, cleanCategory, cleanName, extensionOf } from "@/lib/files";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/documents/:id  - metadata only. Needs read access.
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

// strictObject: any extra key (owner_id, storage_key, deleted_at, ...) is a 400,
// so a client cannot slip in fields we never meant to be editable ("mass assignment").
const patchBody = z
  .strictObject({
    name: z.string().max(300).optional(),
    category: z.string().max(100).optional(),
  })
  .refine((v) => v.name !== undefined || v.category !== undefined);

// PATCH /api/documents/:id  { name?, category? } - needs EDIT access (owner or edit grant).
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;

    const parsed = patchBody.safeParse(await readJson(req));
    if (!parsed.success) throw new HttpError(400, "invalid_body");
    const newName = parsed.data.name !== undefined ? cleanName(parsed.data.name) : undefined;
    const newCategory = parsed.data.category !== undefined ? cleanCategory(parsed.data.category) : undefined;

    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "edit",
      auditAction: "update",
      details: { new_name: newName, new_category: newCategory },
    });

    // A rename may not break the link between the name and the real file type.
    if (newName !== undefined && !ALLOWED_TYPES[doc.mime_type]?.includes(extensionOf(newName))) {
      throw new HttpError(400, "extension_must_match");
    }

    const patch: Record<string, string> = {};
    if (newName !== undefined) patch.name = newName;
    if (newCategory !== undefined) patch.category = newCategory;

    const { data, error } = await supabaseAdmin
      .from("documents")
      .update(patch)
      .eq("id", doc.id)
      .is("deleted_at", null) // not deleted in the meantime
      .select("id, name, category, updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "not_found");

    return json({ id: data.id, name: data.name, category: data.category, updatedAt: data.updated_at });
  } catch (err) {
    return handleError(err);
  }
}

// DELETE /api/documents/:id - OWNER ONLY (soft delete; the file and all history remain).
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;

    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "delete",
      auditAction: "delete",
    });

    const { data, error } = await supabaseAdmin
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", doc.id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "not_found");

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}