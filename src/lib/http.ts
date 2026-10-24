import "server-only";
import { NextResponse } from "next/server";

/** An error we deliberately want the client to see (safe message, right status). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code);
  }
}

/** JSON response that must never be cached by a browser or CDN. */
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * One place that turns errors into responses.
 * - HttpError  -> its own status + short code.
 * - anything else (SQL errors, bugs) -> generic 500. Details are logged on the
 *   server ONLY, never sent to the client (they could leak table names, etc.).
 */
export function handleError(err: unknown) {
  if (err instanceof HttpError) {
    return json({ error: err.code }, err.status);
  }
  console.error("Unhandled error:", err);
  return json({ error: "internal_error" }, 500);
}

/**
 * CSRF defence in depth for state-changing routes (POST/PUT/PATCH/DELETE).
 * Browsers always send an Origin header on cross-site writes. If it is present
 * and does not match our own host, refuse. (Session cookies are already
 * SameSite=Lax; this is a second, independent lock.)
 * A request with no Origin (curl, server-to-server) passes: it cannot ride a
 * victim's browser session.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "bad_origin");
  }
  if (originHost !== host) throw new HttpError(403, "bad_origin");
}

/** Reads a small JSON body safely: size-capped, parse errors become 400. */
export async function readJson(req: Request, maxBytes = 10_000): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "body_too_large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "body_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}