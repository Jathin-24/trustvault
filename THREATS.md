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
