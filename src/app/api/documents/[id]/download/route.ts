import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireDocAccess } from "@/lib/authz";
import { attachmentHeader } from "@/lib/files";
import { handleError, HttpError } from "@/lib/http";
import { getObject, sha256Hex } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/documents/:id/download - needs read access.
//
// The file is STREAMED THROUGH THIS SERVER. No signed URL is ever handed out,
// so there is nothing that can outlive a revocation: a revoked user's very
// next request fails the check below.
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    // THE authorization decision for downloads. If this line were removed the
    // route would have no `doc` (and no storage key) to work with.
    const { doc } = await requireDocAccess({
      user,
      documentId: id,
      need: "read",
      auditAction: "download",
    });

    const bytes = await getObject(doc.storage_key);

    // Integrity: the stored bytes must still hash to what we recorded at upload.
    if (sha256Hex(bytes) !== doc.sha256) {
      try {
        await logAudit({
          actorId: user.id,
          action: "integrity_failure",
          documentId: doc.id,
          outcome: "denied",
          details: { during: "download" },
        });
      } catch (e) {
        console.error("could not audit integrity failure:", e);
      }
      throw new HttpError(500, "integrity_error");
    }

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": doc.mime_type, // from OUR validated record, not the client
        "Content-Length": String(bytes.length),
        "Content-Disposition": attachmentHeader(doc.name, doc.mime_type), // never inline
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}