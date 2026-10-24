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