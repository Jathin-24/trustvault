# TrustVault

A secure document vault: teams upload documents, share them with exact per-person permissions (read/edit), and every access decision is recorded in a tamper-evident, hash-chained audit log. Built with Next.js 16 (App Router), Clerk (authentication), Supabase (PostgreSQL + Storage, RLS) and deployed on Vercel.

**Live demo:** https://trustvault-seven.vercel.app

## Demo accounts

All three share one password — it is published here on purpose (this is a demo project with no real data; see T-13 in `THREATS-NUMBERED.md`):

| Account | Role | What it shows |
|---|---|---|
| `admin@vaultdemo.com` | admin | Admin console: users/roles, all documents (metadata only — never contents), full audit log, chain verification |
| `ravi@vaultdemo.com` | member (owner) | Owns most of the demo shelf, shares documents with Meena |
| `meena@vaultdemo.com` | member (grantee) | Read on *rental-agreement*, *invoice-october*, *shared-report*; **edit** on *collab-draft*; owns *meena-draft* and *meena-notes* |

**Password for all three:** `TrustVault-Demo-2026!`

Sign-up also works for new accounts: a new user always joins as `member`, and can only receive access to documents someone shares with them.

## What the demo shelf contains

Eleven live documents (seeded by `scripts/seed.mjs`, leftovers from testing are soft-deleted): seven owned by Ravi (incl. *salary-secret.pdf*, which nobody else may open — admins can see that it exists but never its contents), two owned by Meena, plus two files uploaded during walkthroughs. Downloads are always served as attachments (`nosniff` + sandboxed CSP), never rendered inline.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + React 19 + Tailwind CSS v4, TypeScript, Zod
- **Clerk** for authentication (`src/proxy.ts` middleware: 401 for unsigned API calls, session gate for pages)
- **Supabase** PostgreSQL (RLS on every table, `SECURITY DEFINER` functions with pinned `search_path`) + Supabase Storage (private bucket)
- **Vercel** hosting (GitHub is *not* linked: pushes do not deploy, see below)

## Security model (short version)

- **Authorization is server-side on every request.** `requireUser` / `requireAdmin` in the API layer, `requireDocAccess` for anything document-scoped. The access rule is decided in one pure function (`src/lib/authz-policy.ts`) and enforced again inside the SQL search function.
- **Uniform 404s**: denied, nonexistent and malformed ids answer byte-identically — no existence oracle (timing accepted, T-18).
- **Identity headers are ignored**; only the verified Clerk session counts. Origin is checked before any state change (CSRF → `403 bad_origin`); no CORS grants, `X-Frame-Options: DENY`, no raw HTML rendering.
- **Uploads**: magic-byte type checking against a five-type allow-list, size cap 4 MB, filenames cleaned (traversal/bidi), hash (sha256) re-verified on every download — a swapped object refuses with `integrity_error`.
- **Audit log is append-only** (`UPDATE`/`DELETE`/`TRUNCATE` blocked by trigger) and hash-chained; `verify_audit_chain()` returns NULL when intact, and `/api/admin/audit/verify` exposes the head. The head is anchored manually in the write-up (T-46).
- **Known, documented gaps** (no rate limiting, no CSP, no MFA, no automated tests, …) are listed honestly with statuses in [`THREATS-NUMBERED.md`](THREATS-NUMBERED.md) (T-01…T-79); the prose version is [`THREATS.md`](THREATS.md).

## Getting started (fresh clone)

### 1. Install

```bash
npm install        # or npm ci
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in six values (project settings → API keys):

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → API settings |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API settings (anon/publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API settings (**server-only**, never `NEXT_PUBLIC_`, never committed) |
| `DATABASE_URL` | Supabase → Database settings (used for SQL files / `psql`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk → API keys |
| `CLERK_SECRET_KEY` | Clerk → API keys (**server-only**) |

### 3. Database — run the SQL files in this order

In the Supabase SQL Editor (as `postgres`), or via `psql "$DATABASE_URL" -f <file>`:

1. `db/schema.sql` — tables, triggers, append-only audit chain, RLS on all four tables
2. `db/002_search_documents.sql` — unique lower(email) index + `search_documents()` with the access filter inside the query
3. `db/003_permissions.sql` — `grant_document_access()` / `revoke_document_access()` (advisory lock + one-active-grant index)
4. `db/004_admin.sql` — `admin_update_user()` and `audit_flags()`

To reset everything: run `db/drop_all.sql`, delete the storage objects first as its header describes, then re-run steps 1–4.

### 4. Storage

Create a **private** bucket named `documents` (Storage → New bucket → uncheck Public). The seed script also creates it automatically if missing.

### 5. Seed the demo data

```bash
npm run seed
```

Idempotent — safe to re-run (and safe against the live demo): it *ensures* the three Clerk identities (and re-asserts the documented password), their `users` rows, the eleven demo documents and the four demo grants, creating only what is missing. It writes directly with the service role, so the audit chain stays untouched and seeded rows have no audit history (real user actions are audited by the app).

### 6. Run and deploy

```bash
npm run dev      # http://localhost:3000
```

Deploy with the Vercel CLI (GitHub auto-deploy is intentionally **not** connected — a push does **not** ship):

```bash
vercel deploy --prod
```

## Project structure

```
db/                 SQL: schema, search, permissions, admin (+ drop_all for resets)
scripts/seed.mjs    demo identities, documents, grants (npm run seed)
src/proxy.ts        Clerk middleware (401 on unsigned API calls, session gate on pages)
src/lib/            auth (requireUser/requireAdmin), authz (policy + gate), audit chain,
                    storage (uuid keys, sha256), files (type/size checks), http helpers
src/app/api/        REST routes: /api/documents…, /api/admin…, /api/me
src/app/(app)/      pages: documents, document detail, admin console
```

## Verification status

- **Attack-tested against the deployed site**: [`ATTACK_CHECKLIST.md`](ATTACK_CHECKLIST.md) — Part 1 code audit clean; Part 2 live attacks **140/140** probes held (plus a 134-probe attack run), including a standalone `psql` run proving `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log` all error and `verify_audit_chain()` returns NULL.
- **No automated test suite yet** (T-79) — the access-rule matrix was verified by the attack runners, not by unit tests. This is the top open item in `THREATS-NUMBERED.md`.
- `npm audit`: 0 vulnerabilities; no secrets in git history (checked, C-12).

## Documents

- [`THREATS.md`](THREATS.md) — prose register of threats and their outcomes
- [`THREATS-NUMBERED.md`](THREATS-NUMBERED.md) — numbered register T-01…T-79 with statuses (Closed / Partial / Accepted) and evidence
- [`ATTACK_CHECKLIST.md`](ATTACK_CHECKLIST.md) — the M9 self-attack checklist, ticked, with per-box results
- [`PROMPTS.md`](PROMPTS.md) — log of every real mistake made and caught while building this
