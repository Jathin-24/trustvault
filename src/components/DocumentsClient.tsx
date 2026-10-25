"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/lib/client-api";
import { useApi } from "@/lib/use-api";
import { Badge, Btn, Card, Notice, Pager, formatBytes, formatDate, inputCls } from "@/components/ui";

type Item = {
  id: string; name: string; category: string; mimeType: string; sizeBytes: number; createdAt: string;
  owner: { name: string | null; email: string }; yourAccess: "owner" | "read" | "edit";
};
type ListResp = { page: number; pageSize: number; total: number; items: Item[] };

const MAX_BYTES = 4 * 1024 * 1024;
type Me = { id: string; email: string; role: "admin" | "member"; uploadEnabled: boolean };
const EMPTY = { q: "", owner: "", category: "", from: "", to: "" };

export default function DocumentsClient() {
  const [form, setForm] = useState(EMPTY); // what is typed
  const [applied, setApplied] = useState(EMPTY); // what is searched
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: "10" });
  for (const [k, v] of Object.entries(applied)) if (v.trim()) params.set(k, v.trim());
  const { data, error, loading, reload } = useApi<ListResp>(`/api/documents?${params}`);
  const me = useApi<Me>("/api/me");

  // upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [upOk, setUpOk] = useState<string | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setUpErr(null);
    setUpOk(null);
    const f = fileRef.current?.files?.[0];
    if (!f) return setUpErr("Choose a file first.");
    if (f.size > MAX_BYTES) return setUpErr("File is too large (maximum 4 MB).");
    const fd = new FormData();
    fd.append("file", f);
    if (category.trim()) fd.append("category", category.trim());
    setBusy(true);
    try {
      await api("/api/documents", { method: "POST", body: fd }); // the server validates again
      setUpOk(`Uploaded ${f.name}`);
      if (fileRef.current) fileRef.current.value = "";
      setCategory("");
      setPage(1);
      reload();
    } catch (err) {
      setUpErr(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tone = (a: Item["yourAccess"]) => (a === "owner" ? "green" : a === "edit" ? "blue" : "slate");

  return (
    <>
      {me.data?.uploadEnabled ? <Card title="Upload a document">
        {upErr && <Notice>{upErr}</Notice>}
        {upOk && <Notice kind="ok">{upOk}</Notice>}
        <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
          <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx" className="text-sm" />
          <input className={inputCls} placeholder="Category (optional)" value={category} maxLength={50} onChange={(e) => setCategory(e.target.value)} />
          <Btn type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Btn>
        </form>
        <p className="mt-2 text-xs text-slate-500">PDF, PNG, JPG, TXT or DOCX, up to 4 MB. You become the owner of what you upload.</p>
      </Card> : <Card title="Upload disabled"><p className="text-sm text-slate-600">Your account is currently set to viewer access. An administrator has disabled document uploads for your account. You can still access documents shared with you.</p></Card>}

      <Card title="Your documents">
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); setApplied(form); setPage(1); }}
        >
          <input className={inputCls} placeholder="Name contains…" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
          <input className={inputCls} placeholder="Owner name or email" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
          <input className={inputCls} placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <label className="text-xs text-slate-500">From <input type="date" className={inputCls} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
          <label className="text-xs text-slate-500">To <input type="date" className={inputCls} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
          <Btn type="submit">Search</Btn>
          <Btn type="button" variant="ghost" onClick={() => { setForm(EMPTY); setApplied(EMPTY); setPage(1); }}>Clear</Btn>
        </form>

        {error && <Notice>{error}</Notice>}
        {loading && !data && <p className="text-sm text-slate-500">Loading…</p>}
        {data && data.items.length === 0 && <p className="text-sm text-slate-500">No documents found.</p>}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500">
                <tr><th className="py-2 pr-3">Name</th><th className="pr-3">Category</th><th className="pr-3">Owner</th><th className="pr-3">Your access</th><th className="pr-3">Size</th><th>Uploaded</th></tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 pr-3"><Link className="font-medium text-blue-700 hover:underline" href={`/documents/${d.id}`}>{d.name}</Link></td>
                    <td className="pr-3">{d.category}</td>
                    <td className="pr-3">{d.owner.name ?? d.owner.email}</td>
                    <td className="pr-3"><Badge tone={tone(d.yourAccess)}>{d.yourAccess}</Badge></td>
                    <td className="pr-3">{formatBytes(d.sizeBytes)}</td>
                    <td>{formatDate(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
