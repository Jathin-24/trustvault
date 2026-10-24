import "server-only";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import type { AppUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Admin READS are audited too: "who looked at the audit log, and when" is a
 * fair question. Fails closed like every other allowed action.
 */
export async function auditAdminRead(admin: AppUser, action: string, details?: Record<string, unknown>) {
  await logAudit({ actorId: admin.id, action, outcome: "allowed", details });
}

export const pageParams = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};

export const UUID = z.string().uuid();

/** Turns query-string entries into an object, dropping empty values. */
export function queryObject(url: string) {
  return Object.fromEntries([...new URL(url).searchParams].filter(([, v]) => v !== ""));
}

/** id -> email lookup for rows that reference users. */
export async function emailsFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin.from("users").select("id, email").in("id", unique);
  if (error) throw error;
  for (const u of data ?? []) map.set(u.id, u.email);
  return map;
}

/** id -> name lookup for documents (metadata only; admins never get contents). */
export async function docNamesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin.from("documents").select("id, name").in("id", unique);
  if (error) throw error;
  for (const d of data ?? []) map.set(d.id, d.name);
  return map;
}