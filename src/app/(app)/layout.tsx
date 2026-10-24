import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { getCurrentUser } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import Nav from "@/components/Nav";

// Every page here renders for ONE signed-in person and re-checks their active
// flag on every request, so they can never be prerendered: the shell depends on
// a live session and a live row. Declaring that here (it applies to all child
// routes) also keeps Next's dev prerender from flagging the uncached Supabase
// call in getCurrentUser() as a blocking route.
export const dynamic = "force-dynamic";

// Everything under (app) needs a signed-in, ACTIVE user. This is a convenience
// for the page shell only: the API routes make the real decisions every time.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch (e) {
    if (!(e instanceof HttpError && (e.code === "account_disabled" || e.code === "email_not_verified"))) throw e;
    return (
      <main className="mx-auto mt-24 max-w-md rounded-lg border bg-white p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">Access unavailable</h1>
        <p className="mb-4 text-sm text-slate-600">
          {e.code === "account_disabled" ? "This account has been disabled by an administrator." : "Your email address must be verified."}
        </p>
        <SignOutButton><button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">Sign out</button></SignOutButton>
      </main>
    );
  }
  if (!user) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav isAdmin={user.role === "admin"} email={user.email} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}