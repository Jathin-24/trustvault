"use client";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function Nav({ isAdmin, email }: { isAdmin: boolean; email: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-6 px-4">
        <Link href="/documents" className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900 no-underline">
          <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-xs font-bold text-white">T</span>
          TrustVault
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-1 text-sm">
          <Link href="/documents" className="rounded-lg px-3 py-2 text-slate-600 no-underline transition hover:bg-neutral-100 hover:text-neutral-950">Documents</Link>
          {isAdmin && <Link href="/admin" className="rounded-lg px-3 py-2 text-slate-600 no-underline transition hover:bg-neutral-100 hover:text-neutral-950">Admin</Link>}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span title={email} className="hidden max-w-52 truncate text-xs text-slate-500 sm:block">{email}</span>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
