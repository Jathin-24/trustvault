import type { ButtonHTMLAttributes, ReactNode } from "react";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const formatDate = (s: string) => new Date(s).toLocaleString();

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" };
export function Btn({ variant = "primary", className = "", ...rest }: BtnProps) {
  const styles = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-700 border border-neutral-900",
    ghost: "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300",
    danger: "border border-neutral-300 bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
  }[variant];
  return <button {...rest} className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`} />;
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok"; children: ReactNode }) {
  const c = kind === "error" ? "border-neutral-300 bg-neutral-100 text-neutral-800" : "border-neutral-200 bg-neutral-50 text-neutral-700";
  return <div role="alert" className={`mb-3 rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export function Badge({ children, tone: _tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  return <span className="inline-block rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">{children}</span>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
      <Btn variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Btn>
      <span>Page {page} of {pages} <span className="text-neutral-400">({total} total)</span></span>
      <Btn variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Btn>
    </div>
  );
}

export const inputCls = "rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500";
