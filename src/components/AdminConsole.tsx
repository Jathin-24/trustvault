"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import { Badge, Btn, Card, Notice, Pager, formatBytes, formatDate, inputCls } from "@/components/ui";

const TABS = ["Audit log", "Permission changes", "Documents", "Users", "Flags & integrity"] as const;
type Tab = (typeof TABS)[number];

export default function AdminConsole() {
  const [tab, setTab] = useState<Tab>("Audit log");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Administration</h1>
      <p className="mb-4 text-sm text-slate-500">
        Administrators see activity and metadata. They cannot read document contents unless a document is shared with them like anyone else.
        Everything viewed here is itself recorded in the audit log.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Btn key={t} variant={t === tab ? "primary" : "ghost"} onClick={() => setTab(t)}>{t}</Btn>
        ))}
      </div>
      {tab === "Audit log" && <AuditTab />}
      {tab === "Permission changes" && <PermissionsTab />}
      {tab === "Documents" && <DocumentsTab />}
      {tab === "Users" && <UsersTab />}
      {tab === "Flags & integrity" && <FlagsTab />}
    </>
  );
}

function Status({ error, loading, empty }: { error: string | null; loading: boolean; empty: boolean }) {
  if (error) return <Notice>{error}</Notice>;
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (empty) return <p className="text-sm text-slate-500">Nothing to show.</p>;
  return null;
}

const Th = ({ children }: { children?: React.ReactNode }) => <th className="py-2 pr-3">{children}</th>;
const head = "border-b text-xs uppercase text-slate-500";

// ------------------------------------------------------------------ audit

type AuditRow = {
  id: number; at: string; actor: { id: string; email: string | null } | null; action: string;
  outcome: "allowed" | "denied"; document: { id: string; name: string | null } | null;
  ip: string | null; details: unknown;
};

function AuditTab() {
  const blank = { outcome: "", action: "", from: "", to: "" };
  const [form, setForm] = useState(blank);
  const [applied, setApplied] = useState(blank);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: "25" });
  for (const [k, v] of Object.entries(applied)) if (v.trim()) qs.set(k, v.trim());
  const { data, error, loading } = useApi<{ page: number; pageSize: number; total: number; items: AuditRow[] }>(`/api/admin/audit?${qs}`);

  return (
    <Card title="Audit log">
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(form); setPage(1); }}>
        <select className={inputCls} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
          <option value="">Any outcome</option><option value="allowed">Allowed</option><option value="denied">Denied</option>
        </select>
        <select className={inputCls} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
          <option value="">Any action</option>
          {["upload", "download", "view", "update", "replace_content", "delete", "grant", "revoke", "list_permissions", "role_change", "user_deactivate", "user_activate", "login_blocked", "admin_access_denied", "integrity_failure"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <label className="text-xs text-slate-500">From <input type="date" className={inputCls} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
        <label className="text-xs text-slate-500">To <input type="date" className={inputCls} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
        <Btn type="submit">Filter</Btn>
        <Btn type="button" variant="ghost" onClick={() => { setForm(blank); setApplied(blank); setPage(1); }}>Clear</Btn>
      </form>
      <Status error={error} loading={loading && !data} empty={!!data && data.items.length === 0} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={head}><tr><Th>#</Th><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Result</Th><Th>Document</Th><Th>IP</Th><Th>Details</Th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3 text-slate-400">{r.id}</td>
                  <td className="pr-3 whitespace-nowrap">{formatDate(r.at)}</td>
                  <td className="pr-3">{r.actor?.email ?? "—"}</td>
                  <td className="pr-3 font-mono">{r.action}</td>
                  <td className="pr-3"><Badge tone={r.outcome === "allowed" ? "green" : "red"}>{r.outcome}</Badge></td>
                  <td className="pr-3">{r.document ? (r.document.name ?? r.document.id.slice(0, 8)) : "—"}</td>
                  <td className="pr-3">{r.ip ?? "—"}</td>
                  {/* Rendered as plain text: React escapes it, so stored text can never run as HTML. */}
                  <td className="max-w-xs break-words font-mono text-[11px] text-slate-600">{r.details ? JSON.stringify(r.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}

// ------------------------------------------------------------ permissions

type PermRow = {
  id: string; document: { id: string; name: string | null }; user: string | null; level: string;
  grantedBy: string | null; grantedAt: string; revokedAt: string | null; active: boolean;
};

function PermissionsTab() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ page: number; pageSize: number; total: number; items: PermRow[] }>(`/api/admin/permissions?page=${page}&pageSize=25`);
  return (
    <Card title="Permission changes (every grant ever made)">
      <Status error={error} loading={loading && !data} empty={!!data && data.items.length === 0} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={head}><tr><Th>Document</Th><Th>Person</Th><Th>Level</Th><Th>Granted by</Th><Th>Granted</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{r.document.name ?? r.document.id.slice(0, 8)}</td>
                  <td className="pr-3">{r.user}</td>
                  <td className="pr-3"><Badge tone={r.level === "edit" ? "blue" : "slate"}>{r.level}</Badge></td>
                  <td className="pr-3">{r.grantedBy}</td>
                  <td className="pr-3">{formatDate(r.grantedAt)}</td>
                  <td>{r.active ? <Badge tone="green">active</Badge> : <Badge tone="red">revoked {r.revokedAt ? formatDate(r.revokedAt) : ""}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}

// -------------------------------------------------------------- documents

type DocRow = {
  id: string; name: string; category: string; sizeBytes: number; owner: { email: string | null };
  createdAt: string; deletedAt: string | null; activeGrants: number;
};

function DocumentsTab() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ page: number; pageSize: number; total: number; items: DocRow[] }>(`/api/admin/documents?page=${page}&pageSize=25`);
  return (
    <Card title="All documents (metadata only)">
      <Status error={error} loading={loading && !data} empty={!!data && data.items.length === 0} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={head}><tr><Th>Name</Th><Th>Owner</Th><Th>Category</Th><Th>Size</Th><Th>Shared with</Th><Th>Created</Th><Th>Status</Th></tr></thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{d.name}</td>
                  <td className="pr-3">{d.owner.email}</td>
                  <td className="pr-3">{d.category}</td>
                  <td className="pr-3">{formatBytes(d.sizeBytes)}</td>
                  <td className="pr-3">{d.activeGrants} {d.activeGrants === 1 ? "person" : "people"}</td>
                  <td className="pr-3">{formatDate(d.createdAt)}</td>
                  <td>{d.deletedAt ? <Badge tone="red">deleted</Badge> : <Badge tone="green">live</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </Card>
  );
}

// ------------------------------------------------------------------ users

type UserRow = { id: string; email: string; name: string | null; role: "admin" | "member"; active: boolean; createdAt: string };

function UsersTab() {
  const { data, error, loading, reload } = useApi<{ items: UserRow[] }>("/api/admin/users");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function change(u: UserRow, patch: { role?: "admin" | "member"; active?: boolean }, question: string) {
    if (!confirm(question)) return;
    setMsg(null);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setMsg({ kind: "ok", text: `Updated ${u.email}.` });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    }
  }

  return (
    <Card title="Users">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Status error={error} loading={loading && !data} empty={!!data && data.items.length === 0} />
      {data && data.items.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className={head}><tr><Th>Email</Th><Th>Name</Th><Th>Role</Th><Th>Status</Th><Th>Joined</Th><Th /></tr></thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="py-2 pr-3">{u.email}</td>
                <td className="pr-3">{u.name ?? "—"}</td>
                <td className="pr-3"><Badge tone={u.role === "admin" ? "amber" : "slate"}>{u.role}</Badge></td>
                <td className="pr-3">{u.active ? <Badge tone="green">active</Badge> : <Badge tone="red">disabled</Badge>}</td>
                <td className="pr-3">{formatDate(u.createdAt)}</td>
                <td className="flex justify-end gap-2 py-1">
                  {u.role === "member"
                    ? <Btn variant="ghost" onClick={() => change(u, { role: "admin" }, `Make ${u.email} an administrator?`)}>Make admin</Btn>
                    : <Btn variant="ghost" onClick={() => change(u, { role: "member" }, `Remove administrator rights from ${u.email}?`)}>Make member</Btn>}
                  {u.active
                    ? <Btn variant="danger" onClick={() => change(u, { active: false }, `Disable ${u.email}? They are locked out on their next request.`)}>Disable</Btn>
                    : <Btn variant="ghost" onClick={() => change(u, { active: true }, `Re-enable ${u.email}?`)}>Enable</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-slate-500">You cannot change your own account. New administrators can only be created here or directly in the database.</p>
    </Card>
  );
}

// ------------------------------------------------------------------ flags

type Flag = { kind: string; actor: { email: string | null } | null; count: number; firstAt: string; lastAt: string };
type Verify = { intact: boolean; firstBadId: number | null; head: { lastId: number | null; lastHash: string | null; rowCount: number }; checkedAt: string };

const FLAG_HELP: Record<string, string> = {
  repeated_denials: "5 or more refused attempts by one person",
  mass_download: "20 or more downloads by one person",
  integrity_failure: "a stored file no longer matched its recorded hash",
  admin_probe: "a non-admin tried an admin page",
};

function FlagsTab() {
  const [hours, setHours] = useState(24);
  const { data, error, loading } = useApi<{ items: Flag[] }>(`/api/admin/flags?hours=${hours}`);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [vErr, setVErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runVerify() {
    setBusy(true);
    setVErr(null);
    try {
      setVerify(await api<Verify>("/api/admin/audit/verify"));
    } catch (e) {
      setVErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Worth noticing" right={
        <select className={inputCls} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>last hour</option><option value={24}>last 24 hours</option><option value={168}>last 7 days</option>
        </select>}>
        <Status error={error} loading={loading && !data} empty={!!data && data.items.length === 0} />
        {data && data.items.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className={head}><tr><Th>Flag</Th><Th>Person</Th><Th>Events</Th><Th>First</Th><Th>Last</Th></tr></thead>
            <tbody>
              {data.items.map((f, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-3"><Badge tone="amber">{f.kind}</Badge><div className="text-xs text-slate-500">{FLAG_HELP[f.kind]}</div></td>
                  <td className="pr-3">{f.actor?.email ?? "—"}</td>
                  <td className="pr-3">{f.count}</td>
                  <td className="pr-3">{formatDate(f.firstAt)}</td>
                  <td>{formatDate(f.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Audit log integrity" right={<Btn onClick={runVerify} disabled={busy}>{busy ? "Checking…" : "Verify now"}</Btn>}>
        <p className="mb-2 text-sm text-slate-600">Recomputes every link of the tamper-evident hash chain.</p>
        {vErr && <Notice>{vErr}</Notice>}
        {verify && (
          <>
            {verify.intact
              ? <Notice kind="ok">Chain intact: {verify.head.rowCount} records verified at {formatDate(verify.checkedAt)}.</Notice>
              : <Notice>Chain BROKEN. First record that no longer matches: #{verify.firstBadId}.</Notice>}
            <p className="break-all font-mono text-xs text-slate-600">Latest record #{verify.head.lastId} · {verify.head.lastHash}</p>
            <p className="mt-1 text-xs text-slate-500">Copy this value somewhere outside the database. It lets you detect the newest records being deleted.</p>
          </>
        )}
      </Card>
    </>
  );
}
