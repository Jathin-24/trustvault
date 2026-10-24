threats identified and resolved when designing the authentication process.

Disabled user with a valid session → active checked on every request. Closed.
Role or active reset on sign-in → conflict path never writes them. Closed.
Unverified email claiming a victim's identity → verified primary email only. Closed.
Admin creation → only by direct SQL, no API can promote to admin. Closed.
Anonymous log flooding → unauthenticated requests deliberately not logged. Accepted.
Grantee must have signed in once → you can't grant to someone with no row yet. Accepted (simple, and avoids pre-created accounts that someone else could claim).

threats identified and resolved when designing the document authorization process.

IDOR on document ids (guessing or reusing ids) → server-side check on every route, ids are random UUIDs, same 404 for every denial. Closed.
Existence oracle (403 vs 404) → uniform 404. Closed, except timing, which is accepted.
Malformed ids causing errors or injection → regex before any query, plus parameterized queries. Closed.
Fail-open on errors → DB error gives 500, audit failure on allowed gives 500. Closed.
Admin snooping on contents → no admin rule in policy (D6). Closed.
Audit records the authorization decision, not whether the operation finished. A download that fails after an "allowed" row is over-reported, not hidden. Accepted, and it errs in the safe direction.
Cached permissions → none by design, costs two small queries per request. Accepted trade-off.

threats identified and resolved when designing the document api process.

Disguised malware or wrong file types → real magic bytes checked, extension must agree with content, five-type allow-list. Closed. Accepted: a polyglot (a valid PDF or PNG with extra data appended) passes, but it is served as an attachment with nosniff and a sandboxing CSP, so it cannot run in your origin.
Active content in PDFs → never rendered inline by us. Accepted for the recipient's own viewer.
Filename tricks (path traversal, invisible bidi characters, control characters) → stripped from stored names, and names are never used as paths. Closed.
Mass assignment (owner_id, deleted_at and friends) → strictObject rejects any unlisted field, owner comes from the session only. Closed.
Storage swap (the file replaced behind our back) → sha256 re-checked on every download, mismatch refuses and logs integrity_failure. Closed for the app; someone with the service key could change both the row and the file. Accepted.
CSRF on state changes → SameSite cookies plus an Origin check on POST/PUT/PATCH/DELETE. Closed for browsers.
Resource abuse → 4 MB cap, but no per-user quota and no rate limit. Accepted.
Old file versions stay in storage with no UI to restore them. Accepted.
Search and list are not audited (only the single-document view is). Accepted to avoid noise.
The access rule exists twice, in the TypeScript policy and in the SQL search function, and they could drift apart. Accepted, and a reason to cover both in M11 tests.

threats identified and resolved when designing the permission sharing process.

Privilege escalation by sharing (an edit-holder re-shares or grants themselves more) → owner only, enforced twice, in the policy and inside the SQL function. Closed.
Duplicate or racing grants leaving stale access → partial unique index, advisory lock, one atomic function. Closed, tested with 25 parallel identical grants producing one active row.
IDOR across documents (revoking or reading another document's grants) → the grant must belong to the document in the URL. Closed.
Account enumeration → closed for strangers, the route authorizes before looking the email up. Accepted for owners: user_not_found tells an owner whether an email has an account, and with no rate limit it could be scripted.
Wrong person getting access via email pattern matching → exact lowercase equality plus a DB constraint, ILIKE deliberately avoided so "_" in an address can't act as a wildcard. Closed.
Granting to people who haven't signed up yet is not supported. Accepted, and it avoids pre-created grants that a different person could claim by registering first.
Disabled or deleted users keep old grant rows (history). They can't use them, since getCurrentUser blocks inactive accounts first. Accepted.
The audit row for a grant is written before the change and records the requested email and level, not the final permission id. The table's history columns hold the outcome. Accepted.
