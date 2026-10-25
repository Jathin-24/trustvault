# TrustVault — Submission Write-up

**Project:** TrustVault — secure document sharing with a real audit trail  
**Live website:** https://trustvault-seven.vercel.app/  
**Public repository:** https://github.com/Jathin-24/trustvault



## 1. What problem did you solve, in your own words?

TrustVault is a document-sharing application designed to reduce accidental exposure of confidential files and provide an audit trail of access decisions. Access is granted per document to named users rather than inherited broadly from a shared folder. The server checks authorization on each protected document request, and owners can revoke grants. The application records document and permission activity so administrators can investigate who attempted an action and whether the application allowed or denied it.

## 2. What actually works right now? Be specific and honest.

The application is built with Next.js, Clerk authentication, Supabase Postgres and private Supabase Storage. It includes:

- Sign-in and application-user synchronization, active-account checks, and administrator/member account roles.
- Document upload, listing/search, metadata view, metadata editing, content replacement, download, and soft deletion.
- Per-document `read` and `edit` grants to named users, with owner-only grant and revocation controls.
- Server-side authorization through a shared policy and access gate. The policy defaults to denial; an editor can read and edit but cannot delete or re-share, and administrator status does not itself grant access to document contents.
- Upload validation, including file-content/type checks, filename handling, and a size cap.
- Administrative metadata views, user controls, permission history, audit filters, audit flags, and hash-chain verification.
- An append-only audit table and a hash chain intended to make unauthorized record changes detectable.
- A focused automated test suite for the pure authorization policy in `tests/authz-policy.test.mjs`.

The policy tests do not replace end-to-end tests against the deployed Clerk, Supabase and Storage services. A successful local test run alone does not prove every production route secure. Requests rejected at the hosting layer may not be represented in the application audit log, and an in-flight operation may already have passed its authorization check when a grant is revoked. The audit chain should be periodically anchored outside the database to strengthen detection of privileged rewrites.

## 3. How can the evaluator run it on their machine?

Requirements: a supported Node.js version, npm, a Clerk application, and a Supabase project with the schema and migrations applied.

```bash
git clone https://github.com/Jathin-24/trustvault.git
cd trustvault
npm ci
```

Copy `.env.example` to `.env.local` and fill in the required Clerk and Supabase environment variables. Apply the SQL files in `db/` in the order described in `README.md`; do not run destructive reset scripts against a database containing data you need. Then seed the demo records if desired and start the development server:

```bash
npm run seed
npm run dev
```

Open `http://localhost:3000`. Run the authorization-policy tests with:

```bash
npm test
```

Run the production build and lint checks with:

```bash
npm run build
npm run lint
```

The seed script requires valid configured services and should only be run against a demo/test environment. Keep all secret keys in environment variables; never commit `.env.local` or production service-role keys.

## 4. Which AI tools did you use?

I used AI coding assistance to help reason about the architecture, generate and review implementation changes, work through Clerk/Supabase setup, design the document authorization policy and API routes, prepare deployment commands, and structure the threat register. I used the tool iteratively and checked the generated work against the source code and deployed behavior rather than treating a generated answer as proof. The detailed record is in `PROMPTS.md`.

## 5. What did the AI get wrong, and what did you fix yourself?

One concrete bug found during the attack/testing work was date validation. The initial approach relied on JavaScript date parsing and an invalid-date check. JavaScript normalizes some impossible dates, so a value such as `2026-02-30` could roll into March instead of being rejected. I changed the validation to round-trip the parsed date back to `YYYY-MM-DD` and compare it with the original input in both document search and audit filtering. The fix is recorded in commit `16c0c99`.

The security review also found temporary development endpoints that had been left available in the deployed app. I removed the `/dev-check/me` and `/dev-check/supabase-smoke` routes and their unused helper in commit `841f96a`, then checked that the endpoints returned 404 after deployment.

Other issues found during testing were in my own test harness rather than the application: a PowerShell variable-name collision corrupted a document identifier, and Windows `curl.exe` handling of inline JSON caused malformed request bodies. I corrected the harness and repeated the checks. These examples are documented in `PROMPTS.md` and `ATTACK_CHECKLIST.md`.

## 6. What is not finished?

- The included automated suite exercises the pure authorization policy; broader automated route/integration tests with mocked or dedicated Clerk, Supabase and Storage services are still needed.
- The app-level audit log cannot capture requests rejected before the application handler, including some hosting-layer size-limit responses.
- The audit hash chain is tamper-evident but is not, by itself, proof against an administrator capable of rewriting the database and recomputing the chain. External chain-head anchoring and operational monitoring are needed for a stronger assurance model.
- An operation already in progress may have passed authorization before a concurrent revocation commits; the guarantee is strongest for requests that begin after revocation.
- The authorization model uses administrator/member account roles plus document ownership and `read`/`edit` grants. It does not implement viewer as a separate global account role; viewer access is a document-level grant.

I chose to prioritize narrow, server-enforced document permissions and explicit handling of security limitations over adding unrelated product features. These remaining gaps should be considered before using the application for real confidential documents.
