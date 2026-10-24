import type { ButtonHTMLAttributes, ReactNode } from "react";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const formatDate = (s: string) => new Date(s).toLocaleString();

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
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
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    ghost: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-500",
  }[variant];
  return (
    <button
      {...rest}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok"; children: ReactNode }) {
  const c = kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800";
  return <div role="alert" className={`mb-3 rounded border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  const t = {
    slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-800", red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-800", blue: "bg-blue-100 text-blue-800",
  }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center gap-3 text-sm text-slate-600">
      <Btn variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Btn>
      <span>Page {page} of {pages} ({total} total)</span>
      <Btn variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Btn>
    </div>
  );
}

export const inputCls = "rounded border border-slate-300 px-2 py-1.5 text-sm";