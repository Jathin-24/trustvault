import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getRequestMeta } from "@/lib/request-meta";

export type AuditOutcome = "allowed" | "denied";

export type AuditEvent = {
  actorId: string | null;
  action: string; // e.g. "login_blocked", "download", "grant"
  documentId?: string | null;
  outcome: AuditOutcome;
  details?: Record<string, unknown>;
};

/**
 * Appends one row to the tamper-evident audit log.
 * The ONLY write path is the SQL function append_audit(); this app has no
 * INSERT/UPDATE/DELETE privilege on audit_log itself.
 *
 * It THROWS on failure. Callers decide what that means: for an ALLOWED action
 * the right answer is usually "fail closed" (no audit row, no access).
 */
export async function logAudit(event: AuditEvent): Promise<number> {
  const meta = await getRequestMeta();

  const { data, error } = await supabaseAdmin.rpc("append_audit", {
    p_actor_id: event.actorId,
    p_action: event.action,
    p_document_id: event.documentId ?? null,
    p_outcome: event.outcome,
    p_ip: meta.ip,
    p_user_agent: meta.userAgent,
    p_details: event.details ?? null,
  });

  if (error) {
    throw new Error(`audit write failed: ${error.message}`);
  }
  return data as number;
}