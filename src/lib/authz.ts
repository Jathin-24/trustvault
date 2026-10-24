import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http";
import type { AppUser } from "@/lib/auth";
import {
  decide,
  type AccessKind,
  type DocAction,
  type GrantLevel,
} from "@/lib/authz-policy";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOC_COLUMNS =
  "id, owner_id, name, category, storage_key, mime_type, size_bytes, sha256, created_at, updated_at, deleted_at";

/**
 * A document row. It contains storage_key, which must NEVER be sent to a
 * client. Routes must build their responses field by field, never by
 * spreading this object.
 */
export type DocRecord = {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

async function loadDocAndGrant(documentId: string, userId: string) {
  const [docRes, grantRes] = await Promise.all([
    supabaseAdmin.from("documents").select(DOC_COLUMNS).eq("id", documentId).maybeSingle(),
    supabaseAdmin
      .from("document_permissions")
      .select("level, revoked_at")
      .eq("document_id", documentId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle(),
  ]);
  // A database error must never turn into "allowed": throwing -> 500, no access.
  if (docRes.error) throw docRes.error;
  if (grantRes.error) throw grantRes.error;

  return {
    doc: (docRes.data as DocRecord | null) ?? null,
    grant: (grantRes.data as { level: GrantLevel; revoked_at: string | null } | null) ?? null,
  };
}

/**
 * THE gate for every route that touches one document.
 *
 *  1. Looks up the document and THIS user's active grant, fresh from the
 *     database on every call (no cache, so revocation is immediate).
 *  2. Asks the pure policy (authz-policy.ts) for a decision.
 *  3. Writes an audit row for the decision, allowed OR denied.
 *  4. Denied  -> HTTP 404 "not_found", identical for every denial reason
 *               (missing, deleted, malformed id, no grant, not enough level),
 *               so nothing leaks about whether a document exists.
 *     Allowed -> returns the document. If the audit write fails, access is
 *               refused (500): no audit row, no access.
 *
 * `auditAction` names the operation for the log: "view", "download",
 * "update", "delete", "grant", "revoke", ...
 */
export async function requireDocAccess(params: {
  user: AppUser;
  documentId: string;
  need: DocAction;
  auditAction: string;
  details?: Record<string, unknown>;
}): Promise<{ doc: DocRecord; access: AccessKind }> {
  const { user, documentId, need, auditAction, details } = params;

  const validId = UUID_RE.test(documentId);
  let doc: DocRecord | null = null;
  let grant: { level: GrantLevel; revoked_at: string | null } | null = null;

  // A malformed id never reaches the database (it would cause an error that
  // could leak internals). It is simply a denial.
  if (validId) {
    ({ doc, grant } = await loadDocAndGrant(documentId, user.id));
  }

  const decision = validId
    ? decide({
        userId: user.id,
        doc: doc ? { ownerId: doc.owner_id, deletedAt: doc.deleted_at } : null,
        grant: grant ? { level: grant.level, revokedAt: grant.revoked_at } : null,
        action: need,
      })
    : ({ allowed: false, reason: "invalid_id" } as const);

  // The audit column document_id is a uuid, so a malformed id goes in details.
  const auditBase = {
    actorId: user.id,
    action: auditAction,
    documentId: validId ? documentId : null,
  };

  if (!decision.allowed || !doc) {
    const reason = decision.allowed ? "no_such_document" : decision.reason;
    try {
      await logAudit({
        ...auditBase,
        outcome: "denied",
        details: {
          ...details,
          need,
          reason,
          ...(validId ? {} : { raw_id: documentId.slice(0, 100) }),
        },
      });
    } catch (e) {
      // Still denied even if logging fails; the failure is visible in server logs.
      console.error("could not audit denied access:", e);
    }
    throw new HttpError(404, "not_found");
  }

  // Allowed: record it BEFORE returning. If this throws, the caller gets a 500
  // and never touches the document.
  await logAudit({
    ...auditBase,
    outcome: "allowed",
    details: { ...details, need, access: decision.access },
  });

  return { doc, access: decision.access };
}