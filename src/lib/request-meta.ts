import "server-only";
import { headers } from "next/headers";

export type RequestMeta = { ip: string | null; userAgent: string | null };

/**
 * IP and user agent for the audit log.
 * On Vercel, x-forwarded-for is set by the platform, so its first entry is the
 * real client. On other hosts a client could forge it; the audit log would then
 * record a forged IP (accepted limitation, noted in THREATS.md).
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip");
  return { ip: ip || null, userAgent: h.get("user-agent") };
}