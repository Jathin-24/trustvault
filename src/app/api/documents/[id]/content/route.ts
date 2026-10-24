import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { requireDocAccess } from "@/lib/authz";
import { readUpload } from "@/lib/files";
import { assertSameOrigin, handleError, HttpError, json } from "@/lib/http";
import { putObject, removeObject } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/documents/:id/content  (multipart: file) - needs EDIT access.
// Replaces the file's content. The old file is KEPT in storage (unreferenced),
// and the audit rows hold each version's sha256, so "who changed it, from what,
// to what" stays answerable.
export async function PUT(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;

    // Validation does not depend on the document, so a stranger learns nothing
    // about whether it exists from a 400 vs a 404. Size is capped before parsing.
    const up = await readUpload(req);

    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "edit",
      auditAction: "replace_content",
      details: { new_sha256: up.sha256, new_size: up.size },
    });

    // Type may not change (a PDF stays a PDF).
    if (up.mime !== doc.mime_type) throw new HttpError(400, "file_type_mismatch");

    const newKey = randomUUID();
    await putObject(newKey, up.buffer, up.mime);

    // Only swap if the document still points at the file we authorised against
    // and was not deleted meanwhile (optimistic concurrency).
    const { data, error } = await supabaseAdmin
      .from("documents")
      .update({ storage_key: newKey, size_bytes: up.size, sha256: up.sha256 })
      .eq("id", doc.id)
      .eq("storage_key", doc.storage_key)
      .is("deleted_at", null)
      .select("id, size_bytes, updated_at")
      .maybeSingle();

    if (error || !data) {
      await removeObject(newKey);
      if (error) throw error;
      throw new HttpError(409, "conflict");
    }

    return json({ id: data.id, sizeBytes: data.size_bytes, updatedAt: data.updated_at });
  } catch (err) {
    return handleError(err);
  }
}