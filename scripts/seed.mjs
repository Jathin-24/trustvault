#!/usr/bin/env node
/**
 * TrustVault demo seed — creates the demo identities, database rows, documents
 * and grants described in README.md. Idempotent: everything is "ensure", never
 * "recreate", so it is safe to run repeatedly (and against production).
 *
 * Usage:   npm run seed        (reads .env.local from the repo root)
 *
 * It needs the same three server-side values the app uses:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLERK_SECRET_KEY
 *
 * NOTE: this seed writes the database and storage DIRECTLY (service role), so
 * the audit chain is untouched and no audit rows are written for seeded data.
 * Audit rows are written by the application when a real user does something.
 */
import { readFileSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- env loading
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLERK_SECRET = process.env.CLERK_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !CLERK_SECRET) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CLERK_SECRET_KEY (set them in .env.local)");
  process.exit(1);
}

const PASSWORD = "TrustVault-Demo-2026!"; // documented in README.md on purpose (T-13)
const BUCKET = "documents";

// ------------------------------------------------------------------ demo data
const IDENTITIES = [
  { email: "admin@vaultdemo.com", username: "tvadmin", name: "Alice Admin", role: "admin" },
  { email: "ravi@vaultdemo.com", username: "tvravi", name: "Ravi Owner", role: "member" },
  { email: "meena@vaultdemo.com", username: "tvmeena", name: "Meena Grantee", role: "member" },
];

function pdf(title, lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const ops = [`BT /F1 16 Tf 72 760 Td (${esc(title)}) Tj ET`];
  let y = 730;
  for (const line of lines) {
    ops.push(`BT /F1 11 Tf 72 ${y} Td (${esc(line)}) Tj ET`);
    y -= 16;
  }
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function txt(lines) {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

// name, owner email, category, mime, bytes — the curated demo shelf
const DOCUMENTS = [
  { name: "rental-agreement.pdf", owner: "ravi@vaultdemo.com", category: "contracts",
    data: pdf("Residential Tenancy Agreement", ["Parties: Ravi Owner and example Properties Ltd.", "Term: 12 months, demo data only.", "This document is seeded content for the TrustVault demo."]) },
  { name: "invoice-october.pdf", owner: "ravi@vaultdemo.com", category: "finance",
    data: pdf("Invoice #2026-10", ["Billed to: Demo Customer", "Amount: INR 42,000 (demo figures)", "Seeded by scripts/seed.mjs"]) },
  { name: "meeting-notes.pdf", owner: "ravi@vaultdemo.com", category: "general",
    data: pdf("Weekly Sync Notes", ["- Ship the demo", "- Keep the audit chain intact", "- Seeded content for the TrustVault demo"]) },
  { name: "collab-draft.pdf", owner: "ravi@vaultdemo.com", category: "general",
    data: pdf("Collaborative Draft", ["Ravi owns this. Meena holds EDIT access (seeded grant).", "Try renaming or replacing it as Meena."]) },
  { name: "shared-report.pdf", owner: "ravi@vaultdemo.com", category: "reports",
    data: pdf("Quarterly Summary", ["Ravi owns this. Meena holds READ access (seeded grant)."]) },
  { name: "salary-secret.pdf", owner: "ravi@vaultdemo.com", category: "hr",
    data: pdf("Compensation (private)", ["Only Ravi can open this — nobody else holds a grant.", "Admins can see that it exists, never its contents (design D6)."]) },
  { name: "q1-report.pdf", owner: "ravi@vaultdemo.com", category: "reports",
    data: pdf("Q1 Report", ["Seeded content for the TrustVault demo."]) },
  { name: "meena-draft.pdf", owner: "meena@vaultdemo.com", category: "general",
    data: pdf("Meena's Draft", ["Owned by Meena. Ravi (the owner of other docs) cannot open it."]) },
  { name: "meena-notes.txt", owner: "meena@vaultdemo.com", category: "general", mime: "text/plain",
    data: txt(["Meena's plain-text notes.", "Downloads are always served as attachments with nosniff."]) },
];

// owner email -> grantee email -> level (created only when the pair is missing)
const GRANTS = [
  { doc: "rental-agreement.pdf", owner: "ravi@vaultdemo.com", grantee: "meena@vaultdemo.com", level: "read" },
  { doc: "invoice-october.pdf", owner: "ravi@vaultdemo.com", grantee: "meena@vaultdemo.com", level: "read" },
  { doc: "collab-draft.pdf", owner: "ravi@vaultdemo.com", grantee: "meena@vaultdemo.com", level: "edit" },
  { doc: "shared-report.pdf", owner: "ravi@vaultdemo.com", grantee: "meena@vaultdemo.com", level: "read" },
];

// ------------------------------------------------------------------- helpers
const sHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const cHeaders = { Authorization: `Bearer ${CLERK_SECRET}`, "Content-Type": "application/json" };

async function rest(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sHeaders, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function clerk(path, opts = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, { ...opts, headers: { ...cHeaders, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`clerk ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------- main
let ensured = 0, created = 0, skipped = 0;
const note = (msg) => console.log(`  ${msg}`);

// 1. Clerk identities (create if missing, then make sure the password matches
//    the README so demo logins never drift from the docs).
const clerkIds = {};
for (const id of IDENTITIES) {
  const found = await clerk(`/users?email_address=${encodeURIComponent(id.email)}`);
  let user = found[0];
  if (!user) {
    try {
      user = await clerk("/users", { method: "POST", body: JSON.stringify({ email_address: [id.email], username: id.username, password: PASSWORD }) });
    } catch (err) {
      console.error(`Could not create ${id.email} (username "${id.username}" may already be taken): ${err.message}`);
      process.exit(1);
    }
    created++;
    note(`clerk user created: ${id.email}`);
  } else {
    skipped++;
  }
  clerkIds[id.email] = user.id;
  const currentPasswordOk = false; // Clerk does not expose it; always re-assert it
  if (!currentPasswordOk) {
    await clerk(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password: PASSWORD }) });
    ensured++;
  }
}
console.log(`clerk identities: ${IDENTITIES.length} (created ${created}, existing ${skipped}, password re-asserted on all)`);

// 2. users rows (service-role upsert on the unique clerk_id)
for (const id of IDENTITIES) {
  const rows = await rest(`users?clerk_id=eq.${clerkIds[id.email]}&select=id,role,active`);
  if (rows.length === 0) {
    const inserted = await rest("users?on_conflict=clerk_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ clerk_id: clerkIds[id.email], email: id.email, name: id.name, role: id.role, active: true }),
    });
    note(`users row created: ${id.email} (${id.role})`);
    clerkIds[id.email + ":db"] = inserted[0].id;
  } else {
    clerkIds[id.email + ":db"] = rows[0].id;
    if (rows[0].role !== id.role || rows[0].active !== true) {
      await rest(`users?id=eq.${rows[0].id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ role: id.role, active: true }) });
      note(`users row corrected: ${id.email} -> role=${id.role}, active`);
    }
  }
}
console.log("users rows: ensured for all demo identities");

// 3. storage bucket (fresh installs)
const buckets = await (await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: sHeaders })).json();
if (!Array.isArray(buckets) || !buckets.some((b) => b.id === BUCKET)) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST", headers: { ...sHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (!res.ok) throw new Error(`create bucket -> ${res.status} ${await res.text()}`);
  note(`storage bucket "${BUCKET}" created (private)`);
} else {
  note(`storage bucket "${BUCKET}" present`);
}

// 4. documents (skip any name+owner that already exists un-deleted)
for (const d of DOCUMENTS) {
  const ownerId = clerkIds[`${d.owner}:db`];
  const existing = await rest(`documents?name=eq.${encodeURIComponent(d.name)}&owner_id=eq.${ownerId}&deleted_at=is.null&select=id`);
  if (existing.length > 0) continue;
  const key = randomUUID();
  const mime = d.mime || "application/pdf";
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST", headers: { ...sHeaders, "Content-Type": mime, "x-upsert": "false" }, body: d.data,
  });
  if (!up.ok) throw new Error(`storage upload ${d.name} -> ${up.status} ${await up.text()}`);
  await rest("documents", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      owner_id: ownerId, name: d.name, category: d.category, storage_key: key,
      mime_type: mime, size_bytes: d.data.length, sha256: sha(d.data),
    }),
  });
  note(`document created: ${d.name} (owner ${d.owner})`);
}
console.log(`documents: ${DOCUMENTS.length} on the demo shelf (existing kept as-is)`);

// 5. grants (skip pairs that already hold an active grant)
for (const g of GRANTS) {
  const ownerId = clerkIds[`${g.owner}:db`];
  const granteeId = clerkIds[`${g.grantee}:db`];
  const docs = await rest(`documents?name=eq.${encodeURIComponent(g.doc)}&owner_id=eq.${ownerId}&deleted_at=is.null&select=id`);
  if (docs.length === 0) { note(`grant skipped, document missing: ${g.doc}`); continue; }
  const active = await rest(`document_permissions?document_id=eq.${docs[0].id}&user_id=eq.${granteeId}&revoked_at=is.null&select=id,level`);
  if (active.length > 0) continue;
  await rest("rpc/grant_document_access", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_document_id: docs[0].id, p_user_id: granteeId, p_level: g.level, p_granted_by: ownerId }),
  });
  note(`grant created: ${g.grantee} ${g.level} on ${g.doc}`);
}
console.log(`grants: ${GRANTS.length} intended (existing kept as-is)`);

console.log("\nSeed complete. Sign in with the accounts in README.md.");
console.log("Audit note: seeded rows are written directly, so no audit rows exist for them; real user actions are audited by the app.");
