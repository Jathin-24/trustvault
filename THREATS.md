threats identified and resolved when designing the authentication process.

Disabled user with a valid session → active checked on every request. Closed.
Role or active reset on sign-in → conflict path never writes them. Closed.
Unverified email claiming a victim’s identity → verified primary email only. Closed.
Admin creation → only by direct SQL, no API can promote to admin. Closed.
Anonymous log flooding → unauthenticated requests deliberately not logged. Accepted.
Grantee must have signed in once → you can’t grant to someone with no row yet. Accepted (simple, and avoids pre-created accounts that someone else could claim).