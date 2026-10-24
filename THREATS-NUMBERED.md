# THREATS-NUMBERED.md — T-01 to T-79

Numbered companion to the prose register in `THREATS.md`. Group ranges follow `ATTACK_CHECKLIST.md` (Identity T-01–08, auth gaps T-09–13, Authorization/IDOR T-14–25, Revocation T-26–31, Uploads T-32–42, Audit T-43–53, Administration T-54–58, Supabase T-59–61, Supabase/ops gaps T-62–65, Web T-66–72, project-wide T-73–79).

**Status legend.** *Closed* — weakness designed out and observed holding under test. *Partial* — the control exists but could not be fully verified in this environment (says why). *Accepted* — known gap, deliberately lived with (says why it is tolerable and what limits it).

**M9 evidence.** Two scripted runners against the live deployment `https://trustvault-seven.vercel.app`: `m9-attack.ps1` 134/134 probes and `m9-checklist.ps1` 140/140 probes (5 runs, final run chain 1203→1336 intact), plus a standalone `psql` tamper run for A-24. Part 1 code audit clean after two fixes: `16c0c99` (audit date filter bug) and `841f96a` (unguarded dev-check routes removed). Chain verified NULL via `select verify_audit_chain();`, API head `lastId 1349 / hash e3cfc1b1…97236c` (later re-verify: 1351, intact).

---

## Identity (T-01 – T-08)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-01 | A disabled or deleted user keeps a valid session cookie | `active` (and role) are re-read from the session row on **every** request; a saved `/api/me` replay after disable → `403 account_disabled` + `login_blocked` audit row; re-enable → works again (A-03). Disabled users' old grant rows are unusable for the same reason. | Closed |
| T-02 | Sign-in resetting `role`/`active` from the identity provider | The conflict path never writes them; only direct SQL or the admin route (T-56) changes them (A-02 control, A-27 restore) | Closed |
| T-03 | Unverified email claiming a victim's identity | `provisionUser` accepts only a verified primary email (`403 email_not_verified` in `src/lib/auth.ts`). **Live check impossible here**: this Clerk instance marks backend-created emails `verified` (`strategy:"admin"`) and its add/delete-email endpoints 404, so an unverified state cannot be staged (A-04). Code path reviewed, not observed live. | **Partial (environment-limited)** |
| T-04 | Privilege escalation to admin | No API promotes to admin; only direct SQL can create one. A-26/A-27 confirm the gate and the `cannot_modify_self` guard | Closed |
| T-05 | Anonymous request flooding | Unauthenticated requests are refused by middleware (401), deliberately not audited (no unauthenticated logging), and change no state (A-01). Residual brute-force volume → T-73 | Accepted |
| T-06 | Granting to accounts that do not exist yet | A grantee must have signed in once (a `users` row exists); grants to unregistered emails are refused. This also blocks "pre-created grant claimed by whoever registers that email first" | Accepted |
| T-07 | Forging identity with request headers (`x-role`, `x-user-id`) | Identity comes only from the verified Clerk session; Meena with admin headers still gets `403 forbidden` and nothing changes (A-02) | Closed |
| T-08 | Signed-out access to any endpoint | All 11 signed-out GETs → `401`; POST/PUT/PATCH/DELETE → `401` before method matching (A-01) | Closed |

## Auth gaps (T-09 – T-13)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-09 | No multi-factor authentication | Clerk supports MFA but the demo accounts are password-only. A stolen password alone would sign in | Accepted (known floor gap; documented in the write-up) |
| T-10 | Replay of a stolen/expired session cookie | Session JWTs are short-lived (~60 s) and every request re-checks `role`/`active`, so disabling the account blocks a stolen cookie immediately (A-03 replay). Residual: while the account is *enabled*, possession of the cookie = possession of the session (normal web model) | Closed |
| T-11 | Email in our `users` table not re-synced after a Clerk change | `users.email` is written at provision time; a later Clerk-side email change is not propagated, and grants are keyed to the email used at grant time. Demo accounts never change email | Accepted |
| T-12 | The grant route used as an account oracle, or wrong-person grants via email pattern tricks | Authorization runs **before** the email lookup, so a denied grant and a grant on a nonexistent document answer identically; matching is exact lowercase equality with a DB constraint (no `ILIKE`, so `_` cannot wildcard). Closed for strangers; for *owners*, `user_not_found` reveals whether an email has an account and with no rate limit it could be scripted | Partial (owners' enumeration accepted) |
| T-13 | Demo admin credentials are public | The three demo accounts (incl. admin) and their shared password appear in the README/demo script by design so reviewers can log in | Accepted (demo project; no real data) |

## Authorization and IDOR (T-14 – T-25)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-14 | IDOR on document ids (guessing or reusing ids) | Server-side `requireDocAccess` on every document route, random UUID ids, identical `404 {"error":"not_found"}` for every denial — stranger, Meena-beyond-read, edit-beyond-owner and grantless admin all get it (A-05, A-06, A-07, A-08) | Closed |
| T-15 | Malformed ids causing errors, injection or leakage | Regex validation before any query + parameterized queries; `$ZERO`, `abc`, `..%2F..%2Fadmin`, `1%27%20OR%20…`, 5000-char string → identical app 404, never 500. **Exception**: `%00` is rejected by Vercel's edge (plain-text 400) before any handler runs, so it is neither a 404 nor audit-logged (12 stranger rows, not 13). Never 200/500 either way (A-09) | **Partial (platform boundary)** |
| T-16 | Existence oracle (403 vs 404 distinguishing real ids) | Uniform 404 for denied-real, well-formed-nonexistent and malformed ids; body bytes identical | Closed |
| T-17 | Fail-open on internal errors | Fail closed: a DB error inside the gate throws → 500; an audit failure on an *allowed* decision also 500s the request rather than serving it unaudited (C-08) | Closed |
| T-18 | Timing differences on a 404 revealing existence | Measured response-time medians over the same code path were indistinguishable, but a timing side channel can never be fully ruled out by sampling | Accepted |
| T-19 | Mass assignment (`owner_id`, `storage_key`, `deleted_at`, `role`) | Zod `strictObject` rejects any unlisted field with 400; owner comes from the session only; extra multipart field `owner_id` ignored/refused (A-11) | Closed |
| T-20 | Search/list leakage across users (`q=%`, `q=_`, `owner=`) | Scoping is enforced inside the SQL search function; Meena's wildcard/owner probes never return documents she cannot reach, admin list shows only owned/granted (A-12) | Closed |
| T-21 | Paging abuse (`pageSize=100000`, `page=-1`, `page=abc`) | 400 or clamped, never 500 (A-13). The audit API additionally caps `pageSize` (< 200) | Closed |
| T-22 | Cross-document grant id (revoking another document's grant) | The grant must belong to the document in the URL → 404, and the other document's grant stays active (A-10) | Closed |
| T-23 | Privilege escalation by sharing (edit-holder re-shares, grants themselves more) | Owner only, enforced twice: in the TypeScript policy and inside the SQL grant function (A-07 revoke probe) | Closed |
| T-24 | The access rule exists twice — TypeScript policy and SQL search function — and could drift apart | Single `decide()` implementation is the source of truth and both call sites are covered by hand-tested matrices, but nothing fails the build if they diverge. This is the top reason to add tests (T-79) | Accepted |
| T-25 | `storage_key` or file contents leaking from any response | Never selected into responses; admin documents endpoint is metadata-only (design D6); M9 grepped every list/detail/permission/admin/flag payload across 9 routes — key never appears (A-08, A-29–A-30) | Closed |

## Taking access away (T-26 – T-31)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-26 | Replaying a saved request after revoke (rule 3) | The exact saved cURL that returned 200 returns the reference 404 the moment the grant is revoked (A-14) | Closed |
| T-27 | Cached permissions serving stale access | No caching by design — the gate costs two small queries per request; accepted performance trade-off | Accepted |
| T-28 | Duplicate or racing grants leaving stale access | Partial unique index + advisory lock + one atomic function; tested with 25 parallel identical grants producing exactly one active row; re-grant keeps history with 1 active (A-16) | Closed |
| T-29 | Deleting a document while access is live | Soft delete (`deleted_at`) → 404 for owner, grantee, admin, download and permissions; admin list shows it as deleted (A-17). True erasure → T-42 | Closed (visibility), see T-42 |
| T-30 | A request already in flight at the instant of revoke finishing | Unavoidable small race: a download that started before the revoke commits may complete. The hammer test proved **no request started after** the revoke commit ever returns 200 (A-15) | Accepted (fails safe: serves already-authorized data once) |
| T-31 | Downgrade `edit` → `read` leaving higher access behind | Re-grant replaces atomically: her PATCH → 404, her download still 200 (A-18) | Closed |

## Uploads and files (T-32 – T-42)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-32 | Disguised malware or wrong file types | Real magic bytes checked, extension must agree with content, five-type allow-list: random-bytes `.pdf` → 415, real PDF as `.txt` → 400, `.zip` → 415, SVG/HTML text → 400 `file_type_mismatch` (A-19). A *polygshot* (valid PDF with extra data appended) passes because its magic bytes are a real PDF — but is always served attachment + nosniff + sandbox CSP, so it cannot run (T-38) | Closed (detection), Accepted (polyglot, safe serving) |
| T-33 | Active content inside PDFs | Never rendered inline by the app; the recipient's own viewer opens it | Accepted |
| T-34 | Filename tricks (path traversal, bidi/invisible characters) | Stripped from stored names and names are never used as paths: `../../x.pdf` → `passwd.pdf`, RLO character removed (`evilfdp.pdf`) (A-19) | Closed |
| T-35 | Type switch through content replacement (PNG bytes onto a PDF) | `400 file_type_mismatch`, original content byte-identical afterwards (sha256 unchanged) and still downloads (A-22) | Closed |
| T-36 | Oversized uploads | 4 MB cap: 4.1 MB body → app JSON `{"error":"file_too_large"}` 413; 5 MB → Vercel edge 413 before the app runs. No per-user quota (→ T-73) | Closed (cap), Accepted (no quota) |
| T-37 | Empty files and garbage multipart bodies | `400 empty_file`, malformed multipart → 400, never 500 (A-19, A-36) | Closed |
| T-38 | Uploaded content rendered in the origin (stored XSS via file) | Every download: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: sandbox …`, never `inline` (A-20) | Closed |
| T-39 | Storage swap — the object replaced behind the app | sha256 re-checked on **every** download; mismatch → 500 `integrity_error` + `integrity_failure` audit row, never wrong bytes (A-21). Residual: a holder of the service key could change row *and* file together. Environment note: the storage GET path serves a stale CDN variant up to `max-age=3600` after an out-of-band overwrite, so a *restore* may keep refusing for up to an hour — failure direction is safe, and normal flows never hit it (the app never overwrites: `upsert:false`, content-PUT mints a new key per version) | Closed (app), Accepted (service-key holder; CDN restore lag is environment-limited) |
| T-40 | Rejected uploads leaving orphan rows or files | Refusals create no document row and no storage object (counts checked before/after each rejection batch) | Closed |
| T-41 | Old file versions remain in storage with no restore UI | Version history bytes stay (deliberate: audit rows hold each version's sha256) but there is no UI to retrieve them; storage cost, no access path | Accepted |
| T-42 | Deletion is logical only — no true erasure | `deleted_at` hides rows everywhere; neither document rows, audit rows nor superseded objects are physically erased. There is no "erase my account/data" path | Accepted (known privacy/erasure gap; audit history must survive deletions by design) |

## Audit trail (T-43 – T-53)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-43 | Audit records the authorization decision, not whether the operation finished | An allowed row is written before the work (and for grants, before the change, with the requested email/level); a later failure over-reports rather than hides. Errors in the safe direction | Accepted |
| T-44 | Search and list are not audited (only single-document view) | Deliberate: auditing every list call would drown the trail; refusals and document-level actions are all recorded (A-23 tally: 45+ denied rows per run with per-class assertions) | Accepted |
| T-45 | Forging audit rows from outside (anon `rpc/append_audit`) | Denied with the anon key (400/401/403/404); `count(*) where action='forged'` → 0 (A-25/A-29) | Closed |
| T-46 | The chain head is anchored **manually** — nothing outside the DB proves the chain start | `verify_audit_chain()` returns NULL (intact) and `/api/admin/audit/verify` exposes the head, but both read the same table; a full chain rewrite would satisfy both. Mitigation: the head is saved outside the database for the write-up — captured `lastId=1349`, `lastHash=e3cfc1b1825d0b9d6503d4b1839319d8628f9b7520a6adf557c8df8a8297236c`, `rowCount=1349`, `2026-10-24 18:23:55 UTC`, `checkedAt 2026-10-24T18:37:58.715Z` (later re-verify: 1351, intact) — compare any future verify against this | Accepted (anchor recorded manually) |
| T-47 | A compromised admin editing audit history (UPDATE/DELETE/TRUNCATE) | Append-only trigger refuses all three from `psql` on production: `ERROR: audit_log is append-only: …`; `verify_audit_chain()` → NULL (A-24, standalone run) | Closed |
| T-48 | Tampering that bypasses the trigger being detectable | M7 tamper demo: trigger disabled, one row edited, `/api/admin/audit/verify` → `intact:false` naming that exact row id; row restored byte-exactly, trigger re-enabled, verify → NULL (8/8) | Closed |
| T-49 | Date filters accepting impossible days (`from=2026-02-30` silently rolling over) | **Found by M9** — JS rolls invalid dates forward. Both date-filtering routes now round-trip the parsed day against the input and refuse anything that is not a real calendar day with `400 invalid_query`; fixed and deployed in `16c0c99` | Closed |
| T-50 | Attacks leaving no trace | Per-class assertions in the checklist run: stranger refusals 12, Meena refusals 10+, uploads 8+, grants 4+, deletes, `admin_access_denied` 7+, integrity failures — each with correct actor, action and `outcome` (A-23) | Closed |
| T-51 | Audit rows expose PII (IP, user-agent, emails in details) | Admin-only endpoint, every admin read itself audited; no public or cross-user audit access (A-26) | Accepted |
| T-52 | Audit outage going unnoticed / unaudited operations | Fail closed: if the allowed-audit write fails, the request 500s instead of proceeding; chain verify endpoint reports `intact`/`firstBadId` for spot checks (A-23 final check) | Closed |
| T-53 | The audit trail covers the app, not the platform edge | Requests rejected by Vercel's edge before a handler runs (e.g. `%00`, 5 MB bodies) leave no audit row — the app cannot log what it never received | Accepted |

## Administration (T-54 – T-58)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-54 | A member reaching admin endpoints | `requireAdmin` re-checks role + active on the session row; all six admin GETs and `PATCH /api/admin/users/<id>` → `403 forbidden` with `admin_access_denied` rows naming the route; admin page/API reads write their own rows (A-26, A-28) | Closed |
| T-55 | One admin attacking another (demote/deactivate), incl. a simultaneous race | `can_modify_self` refuses every change to the acting admin's own row (`400 cannot_modify_self`), there is no delete; two admins racing mutual demotions from parallel jobs → at least one admin remains (A-27) | Closed |
| T-56 | Escalation via smuggled fields (`role`, `is_active`, `root`) | `strictObject` accepts only `role` and `is_active`, `root` is not a settable value; owner/role smuggling elsewhere → 400 (A-11, A-27) | Closed |
| T-57 | Admin cannot read document contents — and there is **no emergency break-glass** | Deliberate (D6): no admin rule in the policy, admin document lists are metadata-only with no `storage_key`, admin GET/download → 404 without a grant. Consequence: if a company's only admin must recover a document, the only path is direct SQL/storage access outside the app | Accepted (deliberate design; emergency access = out-of-band DB/storage access) |
| T-58 | Flag heuristics can be gamed, and admin endpoints have no rate limit of their own | Flags only read the trail and never grant access; every admin call still passes the policy. Rate limiting → T-73 | Accepted |

## Direct access to Supabase (T-59 – T-61)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-59 | Anon-key REST reads (`documents`, `users`, `audit_log`, `document_permissions`) and Supabase Auth sign-up creating side identities | All selects denied/empty under RLS with the anon key; `auth/v1/signup` returned no session (400/429) so no token exists to replay, and the app only ever trusts Clerk sessions (A-29, A-31) | Closed |
| T-60 | Anon-key RPC abuse (`append_audit` forging, `search_documents` cross-user) | Both denied (403/404, `permission denied`); zero forged rows exist (A-29, A-25) | Closed |
| T-61 | Anon-key Storage (bucket list, direct object GET, public object URL) | List denied/empty with no real keys leaked; direct GET never 200; public URL never 200 (bucket private) (A-30) | Closed |

## Supabase / ops gaps (T-62 – T-65)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-62 | The service-role key bypasses every RLS/app check by design | Key exists only in `src/lib/supabase-admin.ts` and server env; never in git (no `.env*` tracked at all) and not in any of 12,687 history lines (C-02, C-12). Anyone holding it could change row + file together (T-39) | Accepted (inherent to the platform; secret hygiene verified) |
| T-63 | Schema applied by hand (`db/*.sql` in SQL editor), no migration tool | Live DB can drift from the repo's SQL files; mitigated by pinned `search_path` counts (C-10), the append-only trigger and `verify_audit_chain()` as smoke checks — but there is no `migrate up/down` | Accepted |
| T-64 | No Clerk → database webhook: provisioning happens on login only | Orphan `users` rows (deleted Clerk accounts) and email changes are cleaned manually; M9 deleted its own probe orphans (0 `m9-*` users, fixtures soft-deleted). Cross-ref T-11 | Accepted |
| T-65 | Temporary dev-check routes shipped unguarded in production | **Found by M9 Part 1 (C-05)**: `/dev-check/me`, `/dev-check/supabase-smoke` (both self-labeled "TEMPORARY") plus their dead `src/lib/supabase/server.ts` helper were live in prod. Removed in `841f96a`, build clean (no route in the table), deployed, smoke-tested: signed-in GET → 404 | Closed (fixed, `fix(security):`) |

## Web layer (T-66 – T-72)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-66 | XSS through stored names, categories or audit details | Every value renders as text (React escapes), no `dangerouslySetInnerHTML`/`innerHTML` anywhere (C-06); `<img src=x onerror=…>.pdf` and `<script>` categories round-trip as JSON *data*; list/detail/admin HTML contain no raw payload tags (A-34) | Closed |
| T-67 | CSRF — a cross-site page writing with the victim's session | SameSite cookies plus an Origin check **before** authorization on every state-changing route: evil origin → `403 bad_origin` on PATCH and upload; same-origin control → 200 (A-32) | Closed (browsers) |
| T-68 | Clickjacking (framing the app to harvest clicks) | `X-Frame-Options: DENY` on every page response, plus HSTS and `Referrer-Policy` (A-35, header-level verification) | Closed |
| T-69 | No Content-Security-Policy | The app serves no CSP on its own pages (downloads get a sandbox CSP, T-38). Clerk needs several script/connect origins and a CSP could not be validated against those keys in the time available; XSS defence currently rests on React escaping + no raw HTML (T-66) | Accepted (declared next hardening step) |
| T-70 | Stale UI controls (a revoked editor still sees the Edit card until reload) | UI is advisory only — every action is re-checked by the API, which refuses regardless of what the button showed | Accepted |
| T-71 | Admin screens display personal data (emails, IPs) | Admin-only, and every admin read is itself audited (T-51) | Accepted |
| T-72 | Cross-origin reading of responses (CORS) | No `Access-Control-Allow-Origin` is ever granted (plain or preflight), so a browser on another origin cannot read any API response (A-33, header-level verification) | Closed |

## Project-wide (T-73 – T-79)

| ID | Threat | Response / evidence | Status |
|----|--------|---------------------|--------|
| T-73 | No rate limiting anywhere | Login, grant-lookup (`user_not_found` enumeration, T-12), uploads and admin endpoints can be scripted at any volume; per-user quota also absent (T-36). Only per-provider limits (Vercel body size, Clerk/Supabase defaults) apply | Accepted (declared floor gap) |
| T-74 | Backups / restore never drilled | Supabase's backup story has not been exercised end-to-end; a destructive mistake would rely on the platform's default retention | Accepted |
| T-75 | `verify_audit_chain()` is O(n) and there is no load testing | Chain verification re-hashes every row (1,349 rows today: instant; millions would slow or time out). No measured performance profile exists | Accepted |
| T-76 | Audit rows (with IP + user-agent) are retained forever | No retention/purge policy; consistent with T-42 (audit must survive deletions) but a GDPR-style erasure request would need a deliberate, logged exception process that does not exist | Accepted |
| T-77 | No error monitoring or alerting | 500s are visible only in Vercel function logs; nothing pages anyone, and the flag heuristics (T-58) are read manually | Accepted |
| T-78 | Production ships by manual `vercel deploy --prod` (Vercel ↔ GitHub not connected) | Repo and production can drift if someone forgets the CLI step; mitigated by M10's clean-clone deploy check and by smoke-checking the live URL after each deploy | Accepted |
| T-79 | No automated tests | No Vitest/unit/integration suite exists; the access-rule matrix (T-24) and SQL checks were verified by hand in M9 runners only. The milestone offered ~30 min of tests ("add tests") — if declined, this row stays open and requirement 10 is not met by evidence | Accepted (open item; explicitly listed in the write-up) |
