// TEMPORARY (M3): proves identity works. Remove or keep as a harmless "who am I" endpoint.
import { requireUser } from "@/lib/auth";
import { handleError, json } from "@/lib/http";
import { connection } from "next/server";

export async function GET() {
  // auth() -> headers() is request-bound, so this route can never be prerendered.
  // cacheComponents forbids the route segment config (`dynamic = "force-dynamic"`
  // fails the build), and without opting out, `next build` prerenders the route
  // and dies on "`headers()` rejects when the prerender is complete"
  // (HANGING_PROMISE_REJECTION). connection() suspends the handler during the
  // prerender pass, so headers() is only read while a real request is running.
  await connection();

  try {
    const user = await requireUser();
    return json({ id: user.id, email: user.email, role: user.role, uploadEnabled: user.uploadEnabled });
  } catch (err) {
    return handleError(err);
  }
}