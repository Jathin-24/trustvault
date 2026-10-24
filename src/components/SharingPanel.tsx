"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import { Badge, Btn, Card, Notice, formatDate, inputCls } from "@/components/ui";

type Grant = {
  id: string; level: "read" | "edit"; user: { email: string; name: string | null } | null;
  grantedBy: string | null; grantedAt: string; revokedAt: string | null; active: boolean;
};

// Shown to the owner only (the server refuses everyone else anyway).
export default function SharingPanel({ documentId }: { documentId: string }) {
  const [history, setHistory] = useState(false);
  const { data, error, reload } = useApi<{ items: Grant[] }>(`/api/documents/${documentId}/permissions${history ? "?history=1" : ""}`);
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<"read" | "edit">("read");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (level === "edit" && !confirm("Edit access lets this person rename the document and replace its file. Continue?")) return;
    setBusy(true);
    try {
      const r = await api<{ changed: boolean }>(`/api/documents/${documentId}/permissions`, {
        method: "POST",
        body: JSON.stringify({ email, level }),
      });
      setMsg({ kind: "ok", text: r.changed ? `Access set to "${level}" for ${email}.` : `${email} already had "${level}" access.` });
      setEmail("");
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(g: Grant) {
    if (!confirm(`Remove ${g.user?.email ?? "this person"}'s access? It takes effect immediately.`)) return;
    setMsg(null);
    try {
      await api(`/api/documents/${documentId}/permissions/${g.id}`, { method: "DELETE" });
      setMsg({ kind: "ok", text: "Access removed." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    }
  }

  return (
    <Card
      title="Who can access this document"
      right={<label className="text-xs text-slate-500"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> show history</label>}
    >
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {error && <Notice>{error}</Notice>}

      <form onSubmit={grant} className="mb-4 flex flex-wrap items-end gap-2">
        <input className={inputCls} type="email" required placeholder="person@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value as "read" | "edit")}>
          <option value="read">Can read</option>
          <option value="edit">Can edit</option>
        </select>
        <Btn type="submit" disabled={busy}>Grant access</Btn>
      </form>
      <p className="mb-3 text-xs text-slate-500">The person must have signed in to TrustVault once. Owners always have full access.</p>

      {data && data.items.length === 0 && <p className="text-sm text-slate-500">Not shared with anyone.</p>}
      {data && data.items.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-2">Person</th><th>Level</th><th>Granted</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.id} className="border-b last:border-0">
                <td className="py-2">{g.user?.name ?? g.user?.email} <span className="text-xs text-slate-500">{g.user?.name ? g.user.email : ""}</span></td>
                <td><Badge tone={g.level === "edit" ? "blue" : "slate"}>{g.level}</Badge></td>
                <td>{formatDate(g.grantedAt)}</td>
                <td>{g.active ? <Badge tone="green">active</Badge> : <Badge tone="red">revoked {g.revokedAt ? formatDate(g.revokedAt) : ""}</Badge>}</td>
                <td className="text-right">{g.active && <Btn variant="danger" onClick={() => revoke(g)}>Revoke</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
