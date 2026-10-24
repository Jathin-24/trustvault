import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, type AppUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertSameOrigin, handleError, HttpError, json } from "@/lib/http";
import { readUpload } from "@/lib/files";
import { putObject, removeObject } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase-admin";

// ---------------------------------------------------------------- list/search

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  owner: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type SearchRow = {
  id: string; name: string; category: string; mime_type: string; size_bytes: number;
  created_at: string; updated_at: string; owner_id: string; owner_name: string | null;
  owner_email: string; your_access: "owner" | "read" | "edit"; total_count: number | string;
};

// GET /api/documents?q=&owner=&category=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&pageSize=
// Returns ONLY documents the caller owns or holds an active grant on. The filter
// is inside the SQL function, so there is no "fetch everything then hide some".
export async function GET(req: Request) {
  try {
    const user = await requireUser();

    const raw = Object.fromEntries(
      [...new URL(req.url).searchParams].filter(([, v]) => v !== "")
    );
    const parsed = listQuery.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "invalid_query");
    const p = parsed.data;

    const fromIso = p.from ? new Date(`${p.from}T00:00:00Z`) : null;
    const toIso = p.to ? new Date(Date.parse(`${p.to}T00:00:00Z`) + 86_400_000) : null; // inclusive day
    if ((fromIso && isNaN(+fromIso)) || (toIso && isNaN(+toIso))) throw new HttpError(400, "invalid_query");

    const { data, error } = await supabaseAdmin.rpc("search_documents", {
      p_user_id: user.id,
      p_q: p.q ?? null,
      p_owner: p.owner ?? null,
      p_category: p.category ?? null,
      p_from: fromIso ? fromIso.toISOString() : null,
      p_to: toIso ? toIso.toISOString() : null,
      p_limit: p.pageSize,
      p_offset: (p.page - 1) * p.pageSize,
    });
    if (error) throw error;

    const rows = (data ?? []) as SearchRow[];
    return json({
      page: p.page,
      pageSize: p.pageSize,
      total: rows.length ? Number(rows[0].total_count) : 0,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        owner: { name: r.owner_name, email: r.owner_email },
        yourAccess: r.your_access,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

// --------------------------------------------------------------------- upload

async function auditRejectedUpload(user: AppUser, reason: string) {
  try {
    await logAudit({ actorId: user.id, action: "upload", outcome: "denied", details: { reason } });
  } catch (e) {
    console.error("could not audit rejected upload:", e);
  }
}

// POST /api/documents  (multipart/form-data: file, category?)
// Any signed-in, active user may upload; the uploader becomes the OWNER.
// owner_id always comes from the session, never from the request.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();

    let up;
    try {
      up = await readUpload(req);
    } catch (e) {
      if (e instanceof HttpError) await auditRejectedUpload(user, e.code);
      throw e;
    }

    const docId = randomUUID();
    const storageKey = randomUUID(); // random: never the user's file name

    // Audit FIRST: if this fails we stop, so no document ever exists without a record.
    await logAudit({
      actorId: user.id,
      action: "upload",
      documentId: docId,
      outcome: "allowed",
      details: { name: up.name, category: up.category, mime: up.mime, size: up.size, sha256: up.sha256 },
    });

    await putObject(storageKey, up.buffer, up.mime);

    const { error } = await supabaseAdmin.from("documents").insert({
      id: docId,
      owner_id: user.id,
      name: up.name,
      category: up.category,
      storage_key: storageKey,
      mime_type: up.mime,
      size_bytes: up.size,
      sha256: up.sha256,
    });
    if (error) {
      await removeObject(storageKey); // no orphaned file
      throw error;
    }

    return json({ id: docId, name: up.name, category: up.category, mimeType: up.mime, sizeBytes: up.size }, 201);
  } catch (err) {
    return handleError(err);
  }
}