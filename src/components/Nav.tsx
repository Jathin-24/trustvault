"use client";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export default function Nav({ isAdmin, email }: { isAdmin: boolean; email: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/documents" className="text-lg font-bold text-slate-900">TrustVault</Link>
        <nav className="flex gap-4 text-sm text-slate-700">
          <Link href="/documents" className="hover:underline">Documents</Link>
          {isAdmin && <Link href="/admin" className="hover:underline">Admin</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          <span>{email}</span>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
