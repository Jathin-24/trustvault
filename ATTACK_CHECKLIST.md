# ATTACK_CHECKLIST.md — M9: attack your own system

Do Part 1 (code audit, about 20 minutes), then Part 2 (live attacks on the **deployed** URL, about 90 minutes). Tick a box only when you saw the expected result with your own eyes. If something differs: **stop, fix it, commit with a message like `fix(security): <what>`, re-run the attack, then continue.** Those commits are good evidence of real testing, and any bug that came from AI-written code is a candidate `PROMPTS.md` entry (only if it really happened).

Setup for Part 2: three browser profiles (admin, Ravi, Meena) plus one extra signed-in account with no grants (call it Stranger; create it by signing up). Ravi owns a document `DOC` (note its id). Meena has `read` on `DOC`.

Tip: in Chrome DevTools → Network, right-click any request → **Copy → Copy as cURL (bash)**. That gives you the exact request, with your session cookie, to replay later.

```bash
BASE=https://YOUR-APP.vercel.app
DOC=<document id owned by Ravi>
ZERO=00000000-0000-0000-0000-000000000000
```

> **M9 result (2026-10-24/25): Part 1 clean; Part 2 run by two scripted runners against the live deployment** — 134/134 attack probes (`m9-attack.ps1`) and 140/140 checklist probes (`m9-checklist.ps1`), plus a standalone `psql` run for A-24. Browser-based boxes (A-33, A-35) were verified at the protocol/header level because the harness has no browser. Two boxes stay **unticked** for environment limits (A-04, A-09 %00) — the corresponding THREATS-NUMBERED.md rows are marked *Partial*/*Accepted*. Two app fixes came out of the run: `16c0c99` (audit date bug) and `841f96a` (temporary dev-check routes removed).

---

## Part 1: Code audit (run in your project folder)

Each command has an expected result. Anything else is a finding.

- [x] **C-01 Every API route has a guard. Expect no output.** — all 14 `route.ts` files import `requireUser`/`requireAdmin`.
- [x] **C-01b Document routes go through the gate.** — the only routes without `requireDocAccess` are exactly `admin/*` (7), `api/me`, and `api/documents/route.ts` (list and upload).
- [x] **C-02 The secret key appears only in `supabase-admin.ts`** (and your env files, never in git): `grep -rn "SERVICE_ROLE" src` returns only `src/lib/supabase-admin.ts`; `git ls-files` contains **no** `.env*` file at all (not even `.env.example` — the example file is still to be added in M10).
- [x] **C-03 No client component imports server code. Expect `none`.**
- [x] **C-04 Document access only through `requireDocAccess`.** — every handler under `src/app/api/documents/[id]/**` calls `requireDocAccess` before touching storage or updating a row (grep shows it as the first gate in each of the 5 files, after `requireUser`).
- [x] **C-05 Nothing reads identity or role from the request. Expect no output** (apart from origin/host/forwarded/user-agent). — **finding**: this initially matched `cookies()` in `src/lib/supabase/server.ts`, which existed only to serve a self-labeled "TEMPORARY" `src/app/dev-check/*` smoke page that shipped unguarded in production. Removed both in `841f96a`; the grep is now empty and the deployed site returns 404 on `/dev-check/*`.
- [x] **C-06 No raw HTML rendering. Expect `none`.**
- [x] **C-07 No string-built queries. Expect `none`.**
- [x] **C-08 Fail closed.** — `requireDocAccess` in `src/lib/authz.ts`: a database error throws (500), and the *allowed* audit write happens **before** the document is returned.
- [x] **C-09 Storage keys are never user-controlled.** — keys come only from `randomUUID()` (upload) or the database record (download/replace); `storage_key` never appears in any response body (admin list is metadata-only by design, D6).
- [x] **C-10 Every `SECURITY DEFINER` function pins `search_path`.** — `002_search_documents.sql` 1/1, `003_permissions.sql` 2/2, `004_admin.sql` 2/2, `schema.sql` 9 definer / 11 pinned, `drop_all.sql` 0/0. Pinned never smaller.
- [x] **C-11 No spreading the whole database row into a response. Expect `none`.**
- [x] **C-12 Dependencies and secrets.** — `npm audit`: 0 vulnerabilities. Full history scan (`git log -p --all`, 12,687 lines): no `sk_live_`/`sk_test_`/`eyJhbGciOi` hits; the only `service_role` mentions are SQL `GRANT` lines (expected).

---

## Part 2: Live attacks (the deployed system)

### Identity (T-01 to T-08)

- [x] **A-01 Signed-out access to everything.** — all 11 signed-out GETs → `401`; POST/PUT/PATCH/DELETE signed-out → `401` (middleware blocks before method matching).
- [x] **A-02 Fake identity headers.** — Meena with `x-role: admin` / `x-user-id: <Ravi>` → `403 forbidden`; roles/active unchanged.
- [x] **A-03 Disabled user.** — saved `/api/me` replay after disable → `403 account_disabled`; `login_blocked` audit row present; re-enabled → `200` and works again.
- [ ] **A-04 Unverified email.** *Not ticked — environment-limited.* This Clerk instance marks backend-created emails as `verified` (`strategy: "admin"`) and its add/delete-email endpoints return `404 resource_not_found` on this plan, so an **unverified** state cannot be staged through the API at all. What was observed live: the verification gate runs (a backend-created verified user provisions and gets `200`), while the rejection path (`403 email_not_verified` in `src/lib/auth.ts`) is code-verified but not reproducible here. THREATS-NUMBERED row marked *Partial (environment-limited)*.

### Authorization and IDOR (T-14 to T-25)

Use Stranger's session (no grant). Copy as cURL from any authenticated request and change the path.

- [x] **A-05 Stranger vs Ravi's document.** — all 7 endpoints → identical `404 {"error":"not_found"}`; exactly 7 `denied` audit rows, one per attempt.
- [x] **A-06 Meena (`read`).** — GET `200 yourAccess=read`, download `200`; PATCH / PUT content / DELETE / GET+POST permissions → all `404`.
- [x] **A-07 An `edit` grantee.** — PATCH and PUT content `200`; DELETE, GET/POST permissions and revoke → `404` (live grant id re-read before revoke, so the rule-3 probes test the real revoke).
- [x] **A-08 Admin without a grant.** — admin GET and download → `404`; admin documents list shows the name, never `storage_key`.
- [ ] **A-09 Weird ids.** *Not ticked — one id deviates for platform reasons.* `$ZERO`, `abc`, `..%2F..%2Fadmin`, `1%27%20OR%20%271%27=%271` and the 5000-char string → identical app `404`, never `200`/`500`, all audited. `%00` is rejected by Vercel's edge with a plain-text `400` **before any handler runs**, so it is neither a 404 nor audit-logged (stranger tally 12, not 13). Never 200/500 either way. THREATS-NUMBERED row marked *Partial/Accepted* (edge-vs-app boundary; audit covers the app, not the edge).
- [x] **A-10 Cross-document grant id.** — grant id from doc B used on doc A → `404`; doc B's grant still active afterwards.
- [x] **A-11 Mass assignment.** — `owner_id`, `storage_key`, `deleted_at`, `role` smuggles → each `400`; doc unchanged; upload with extra form field `owner_id=<Meena>` → refused (`400`), document stays owned by Ravi.
- [x] **A-12 Search leakage.** — Meena's `q=<private name>`, `q=%`, `q=_`, `owner=ravi` never return doc A; admin's list shows no documents the admin does not own or was not granted.
- [x] **A-13 Paging abuse.** — `pageSize=100000`, `page=-1`, `page=abc` → each `400`, never `500`.

### Taking access away (T-26 to T-31)

- [x] **A-14 Replay after revoke.** — saved download `200` before revoke; revoke by owner `200`; the **exact same** request replayed → `404` with the reference body.
- [x] **A-15 Hammer during revoke.** — 3+ `200`s while access existed, `404`s from the moment of revoke, **zero `200`s started after the revoke committed** (in-flight requests excluded by start time).
- [x] **A-16 Re-grant.** — re-grant `201`, download works again; history keeps ≥2 rows for Meena with exactly 1 active.
- [x] **A-17 Delete.** — owner DELETE `200`; the document `404`s for owner, grantee and admin; admin list shows `deletedAt` set.
- [x] **A-18 Downgrade.** — fresh document, `edit` then re-grant `read`: her PATCH → `404`, her download still `200`.

### Uploads and files (T-32 to T-42)

Prepare small test files: `fake.pdf` (rename any `.exe` or random bytes), `real.pdf`, `page.html.txt` (HTML text), `a.zip`, `image.svg`, `big.bin` (5 MB), an empty file.

- [x] **A-19** All refusals seen: `fake.pdf` → `415 unsupported_file_type`; real PDF renamed `real.txt` → `400 file_type_mismatch`; `a.zip` → `415`; `image.svg` and `page.html` → `400 file_type_mismatch`; `big.bin` → `413` (and the **app's own** `{"error":"file_too_large"}` JSON `413` proven separately with a 4.1 MB body, since 5 MB dies at the Vercel edge first); empty file → `400 empty_file`; `../../x.pdf` uploads with a cleaned name (`passwd.pdf`); the right-to-left-overrides character is stripped from the stored name (`evilfdp.pdf`); `page.html.txt` is accepted as plain text and downloads as an attachment (see A-20).
- [x] **A-20 Download headers.** — `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy` with `sandbox`, never `inline`.
- [x] **A-21 Storage swap.** — object overwritten behind the app with the service key → download `500 {"error":"integrity_error"}` and an `integrity_failure` audit row. Restore note: re-uploading the original bytes returns `200`, but the storage GET path keeps serving its stale CDN variant for up to `Cache-Control: max-age=3600`, so the app may keep refusing for a while — the failure direction is safe (it refuses, never serves wrong bytes) and normal app flows cannot hit this (the app never overwrites an object: `upsert:false`, and content-PUT mints a new storage key per version). Marked in THREATS as an environment limitation.
- [x] **A-22 Type switch.** — PNG bytes PUT onto a PDF → `400 file_type_mismatch`; original content untouched (sha256 unchanged), still downloads `200`.

### Audit trail (T-43 to T-53)

- [x] **A-23 Everything is recorded.** — per-class assertions all hold (stranger refusals 12, Meena refusals 10+, uploads 8+, grants 4+, deletes 1+, `admin_access_denied` 7+, integrity failures) and 45+ `denied` rows overall for the run. Every attack class above leaves a matching row with the right actor, action and `outcome`.
- [x] **A-24 Tamper attempts.** — standalone `psql` against the production database: `UPDATE audit_log …` → `ERROR: audit_log is append-only: UPDATE is not allowed`; `DELETE FROM audit_log` → same; `TRUNCATE audit_log` → same (all via the `audit_log_block_mutation()` trigger); `SELECT verify_audit_chain();` → **NULL**. The optional tamper demo (disable trigger → edit row → `/api/admin/audit/verify` returns `intact:false` with that row's id → restore exact original → verify NULL again) was performed in M7, 8/8 checks, every row restored byte-exactly.
- [x] **A-25 Forging audit rows from outside.** — `rpc/append_audit` with the anon key → denied (`400/403/404`, never rows); `select count(*) from audit_log where action='forged'` → 0.

### Administration (T-54 to T-58)

- [x] **A-26 Non-admin on every admin route.** — Ravi: six admin GETs and `PATCH /api/admin/users/<id>` → all `403 forbidden`; 7+ `admin_access_denied` rows recorded.
- [x] **A-27 Admin self-harm.** — self-demote → `400 cannot_modify_self`; Meena promoted, both admins race a demotion of each other from two parallel jobs → afterwards at least one admin remains; canonical roles restored (admin=admin, meena=member).
- [x] **A-28 Admin actions are audited.** — `admin_view_audit` and `admin_view_users` rows appear after the calls; `role_change` / `user_deactivate` / `user_activate` rows carry from/to values.

### Direct access to Supabase (T-59 to T-61)

```bash
SB=https://YOUR-PROJECT.supabase.co
ANON=<anon / publishable key from the Supabase dashboard>
H=(-H "apikey: $ANON" -H "Authorization: Bearer $ANON")
```

- [x] **A-29 REST and RPC.** — `documents`, `users`, `audit_log`, `document_permissions` selects with the anon key → denied or empty; `rpc/append_audit` → denied; `rpc/search_documents` → denied; `action='forged'` count → 0.
- [x] **A-30 Storage.** — anon `object/list` → denied/empty with no real storage keys; public object URL → **never 200** (observed `400`, bucket is private); anon direct object GET → never 200.
- [x] **A-31 Supabase Auth sign-up.** — `auth/v1/signup` probe never returned a session (`400`/`429`), so there is no token to replay; A-29 above already covers the denied case.

### Web layer (T-66 to T-72)

- [x] **A-32 CSRF.** — `Origin: https://evil.example` on PATCH and upload → `403 bad_origin`; the same request with the correct Origin → `200`.
- [x] **A-33 CORS.** *Verified at header level (no browser in this harness).* — cross-origin `GET /api/me` response carries **no** `Access-Control-Allow-Origin`, and a preflight (`OPTIONS`) from the evil origin grants nothing, so a browser cannot read the response.
- [x] **A-34 XSS.** — file named `<img src=x onerror=alert(1)>.pdf` + category `<script>alert(1)</script>` accepted as **data** (`201`); the audit API round-trips the payload as a JSON string (never markup); list and detail HTML contain no raw payload tags; the admin page HTML contains none either.
- [x] **A-35 Clickjacking.** *Verified at header level.* — pages are served with `X-Frame-Options: DENY` (plus `Referrer-Policy` and HSTS), so a frame refuses to load.
- [x] **A-36 Error hygiene.** — bad JSON → `{"error":"invalid_json"}`, bad id → short code, upload without file → short code; regex-verified bodies match `^\{"error":"[a-z_]{1,60}"\}$` — no stack traces, SQL or table names anywhere.
- [x] **A-37 Dependencies and history.** — same as C-12: `npm audit` 0 vulnerabilities; history secret scan clean.
- [x] **A-38 Wrong methods.** — `POST /api/documents/$DOC/download`, `PUT /api/documents`, `DELETE /api/me` → `405`/`401` (middleware), never `200`.

---

## After you finish

1. For every box you could not tick, either fix it or change that row in `THREATS.md` to *Partial* or *Accepted* and say why. — A-04 and A-09 are marked *Partial (environment-limited)* in `THREATS-NUMBERED.md`; the prose `THREATS.md` M9 block carries the same caveats.
2. For every **new** weakness you found that is not in `THREATS.md`, add a row. — Added: temporary `dev-check` routes shipped in production (fixed, `841f96a`), the audit-date bug (fixed, `16c0c99`), storage-CDN stale reads after behind-the-app overwrites (accepted, safe direction), and the edge-vs-app audit boundary for `%00`.
3. Run `select verify_audit_chain();` one last time (expect NULL) and note the chain head from `/api/admin/audit/verify`. — NULL confirmed via `psql`; API and psql agree: `{"intact":true,"firstBadId":null,"head":{"lastId":1349,"lastHash":"e3cfc1b1825d0b9d6503d4b1839319d8628f9b7520a6adf557c8df8a8297236c","rowCount":1349},"checkedAt":"2026-10-24T18:37:58.715Z"}` (chain has since advanced with ordinary traffic; re-verify at write-up time returned `lastId: 1351, intact: true`).
4. Commit `THREATS.md` and this checklist (with ticks). — done in the `docs(m9)` commit.
