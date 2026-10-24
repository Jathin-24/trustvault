"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api, errorMessage } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import SharingPanel from "@/components/SharingPanel";
import { Badge, Btn, Card, Notice, formatBytes, formatDate, inputCls } from "@/components/ui";

type Info = {
  id: string; name: string; category: string; mimeType: string; sizeBytes: number;
  createdAt: string; updatedAt: string; isOwner: boolean; yourAccess: "owner" | "read" | "edit";
};

export default function DocumentDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: info, error, loading, reload } = useApi<Info>(`/api/documents/${encodeURIComponent(id)}`);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (loading && !info) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error || !info) {
    return (
      <Card title="Document unavailable">
        <p className="mb-3 text-sm text-slate-600">{error ?? "Not found, or you do not have access."}</p>
        <Link href="/documents" className="text-sm text-blue-700 hover:underline">Back to documents</Link>
      </Card>
    );
  }

  const canEdit = info.yourAccess === "owner" || info.yourAccess === "edit";
  const fail = (e: unknown) => setMsg({ kind: "error", text: errorMessage(e) });
  const base = `/api/documents/${info.id}`;

  async function download() {
    setMsg(null);
    try {
      // Fetched (not a plain link) so a refusal shows a clear message instead of raw JSON.
      const res = await fetch(`${base}/download`, { cache: "no-store" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new ApiError(res.status, d?.error ?? "error");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = window.document.createElement("a");
      a.href = url;
      a.download = info!.name;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      fail(e);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body: Record<string, string> = {};
    if (name !== null && name !== info!.name) body.name = name;
    if (category !== null && category !== info!.category) body.category = category;
    if (!Object.keys(body).length) return setMsg({ kind: "error", text: "Nothing to change." });
    try {
      await api(base, { method: "PATCH", body: JSON.stringify(body) });
      setMsg({ kind: "ok", text: "Saved." });
      setName(null);
      setCategory(null);
      reload();
    } catch (err) {
      fail(err);
    }
  }

  async function replace() {
    setMsg(null);
    const f = fileRef.current?.files?.[0];
    if (!f) return setMsg({ kind: "error", text: "Choose a file first." });
    if (f.size > 4 * 1024 * 1024) return setMsg({ kind: "error", text: "File is too large (maximum 4 MB)." });
    if (!confirm("Replace this document's file? The previous file is kept on record but no longer served.")) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      await api(`${base}/content`, { method: "PUT", body: fd });
      setMsg({ kind: "ok", text: "File replaced." });
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err) {
      fail(err);
    }
  }

  async function remove() {
    if (!confirm("Delete this document? It disappears for everyone, including people it is shared with.")) return;
    try {
      await api(base, { method: "DELETE" });
      router.push("/documents");
    } catch (err) {
      fail(err);
    }
  }

  return (
    <>
      <p className="mb-3 text-sm"><Link href="/documents" className="text-blue-700 hover:underline">← All documents</Link></p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Card title={info.name} right={<Badge tone={info.isOwner ? "green" : info.yourAccess === "edit" ? "blue" : "slate"}>{info.yourAccess}</Badge>}>
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-4">
          <div><dt className="text-xs text-slate-400">Category</dt><dd>{info.category}</dd></div>
          <div><dt className="text-xs text-slate-400">Type</dt><dd>{info.mimeType}</dd></div>
          <div><dt className="text-xs text-slate-400">Size</dt><dd>{formatBytes(info.sizeBytes)}</dd></div>
          <div><dt className="text-xs text-slate-400">Updated</dt><dd>{formatDate(info.updatedAt)}</dd></div>
        </dl>
        <div className="flex gap-2">
          <Btn onClick={download}>Download</Btn>
          {info.isOwner && <Btn variant="danger" onClick={remove}>Delete</Btn>}
        </div>
      </Card>

      {canEdit && (
        <Card title="Edit">
          <form onSubmit={save} className="mb-4 flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">Name<br /><input className={inputCls} value={name ?? info.name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-xs text-slate-500">Category<br /><input className={inputCls} value={category ?? info.category} onChange={(e) => setCategory(e.target.value)} /></label>
            <Btn type="submit">Save changes</Btn>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" className="text-sm" />
            <Btn variant="ghost" onClick={replace}>Replace file</Btn>
            <span className="text-xs text-slate-500">Must be the same type as the current file.</span>
          </div>
        </Card>
      )}

      {info.isOwner && <SharingPanel documentId={info.id} />}
    </>
  );
}
