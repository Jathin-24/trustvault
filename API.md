# TrustVault API Reference

**Base URL:** `https://trustvault-seven.vercel.app` (local development: `http://localhost:3000`)

This reference documents the API routes present in the submitted source tree. All API requests use the signed-in Clerk session cookie; there is no public bearer-token API. JSON responses are sent with `Cache-Control: no-store`.

## Authorization model

- **Signed-in active user:** can list only documents they own or have an active grant for; can upload if uploads are enabled for their account.
- **Document owner:** can read/download, edit metadata/content, soft-delete, and grant/revoke access to that document.
- **Read grantee:** can read metadata and download the file.
- **Edit grantee:** can read/download and edit metadata/content, but cannot delete or re-share.
- **Administrator:** can use administrative metadata, user-management, audit and permission-inspection routes. Admin status does **not** grant access to document contents through the document authorization policy.

Every document-specific route uses the server-side authorization gate. The gate loads the document and the caller's active grant for each request. A denied document access normally returns a uniform `404 {"error":"not_found"}` to avoid disclosing whether a document exists. State-changing browser requests check the `Origin` header when present.

## Common response/error behavior

| HTTP status | Meaning |
|---|---|
| `200` | Request succeeded. |
| `201` | Resource/grant created. |
| `400` | Invalid JSON, query, body, identifier or validation failure. |
| `401` | No valid signed-in user for an API request. |
| `403` | Operation forbidden, such as an administrator-only route or rejected cross-origin write. |
| `404` | Resource missing or document access denied; document denials are intentionally indistinguishable. |
| `409` | Conflict, including concurrent content replacement or guarded administrative update failure. |
| `413` | Request/body too large. Hosting limits may reject oversized requests before the app handler and before app-level audit logging. |
| `500` | Generic internal error; implementation details are not returned to the client. |

Error body format: `{"error":"short_error_code"}`. Exact statuses can vary for hosting/platform rejections that occur before the application route executes.

## Current-user route

### `GET /api/me`

**Who:** Signed-in active user.

Returns the current application's user identity and role. Intended for the client to establish the signed-in user's application profile.

## Document routes

### `GET /api/documents`

**Who:** Signed-in active user.

List and search only documents the caller owns or has an active grant for.

Query parameters:

- `q` — document-name search, up to 100 characters.
- `owner` — owner filter, up to 100 characters.
- `category` — category filter, up to 50 characters.
- `from`, `to` — inclusive date filters in `YYYY-MM-DD` format; invalid calendar dates are rejected.
- `page` — integer from 1 to 10,000; default `1`.
- `pageSize` — integer from 1 to 100; default `20`.

Returns `{ page, pageSize, total, items }`. Each item includes `id`, `name`, `category`, `mimeType`, `sizeBytes`, `createdAt`, `updatedAt`, owner name/email, and `yourAccess`. Internal storage keys are not returned.

### `POST /api/documents`

**Who:** Signed-in active user with uploads enabled. Requires same-origin browser write when an `Origin` header is present.

Content type: `multipart/form-data` with `file` and optional `category`. The server validates file content/type, filename and size; the authenticated uploader becomes the owner. Owner identity is never accepted from the request body.

Returns `201 { id, name, category, mimeType, sizeBytes }`.

### `GET /api/documents/{id}`

**Who:** Owner or active `read`/`edit` grantee.

Returns metadata only: `id`, `name`, `category`, `mimeType`, `sizeBytes`, timestamps, `isOwner`, and `yourAccess`.

### `PATCH /api/documents/{id}`

**Who:** Owner or active `edit` grantee. Requires same-origin browser write when an `Origin` header is present.

JSON body (at least one field required; unknown fields are rejected):

```json
{ "name": "updated-name.pdf", "category": "Contracts" }
```

`name` and `category` are optional individually. Renaming must keep an extension compatible with the validated file type. Fields such as `owner_id`, `storage_key` and `deleted_at` cannot be supplied.

Returns `{ id, name, category, updatedAt }`.

### `DELETE /api/documents/{id}`

**Who:** Owner only. Requires same-origin browser write when an `Origin` header is present.

Soft-deletes the document by setting `deleted_at`; the file and audit history are retained. Returns `{ "ok": true }`.

### `GET /api/documents/{id}/download`

**Who:** Owner or active `read`/`edit` grantee.

Streams the file through the application after a fresh authorization check. It does not issue a signed storage URL. Returns the file bytes with an attachment response header.

### `PUT /api/documents/{id}/content`

**Who:** Owner or active `edit` grantee. Requires same-origin browser write when an `Origin` header is present.

Content type: `multipart/form-data` with `file`. The new file must pass upload validation and match the existing document's MIME type. The update uses an optimistic concurrency check; conflicts return `409`.

Returns `{ id, sizeBytes, updatedAt }`.

## Permission routes

### `GET /api/documents/{id}/permissions`

**Who:** Owner only.

Returns current grants, including permission ID, `level`, grantee details, grant time, revocation time and active status. Add `?history=1` to include revoked grants. History is limited to the most recent 500 rows.

### `POST /api/documents/{id}/permissions`

**Who:** Owner only. Requires same-origin browser write when an `Origin` header is present.

JSON body:

```json
{ "email": "person@example.com", "level": "read" }
```

`level` must be `read` or `edit`. The named person must already have signed in once and have an active account. The owner cannot grant access to themselves. Grant creation/level changes use a database RPC designed to perform the change atomically.

Returns `201` when a grant changes, otherwise `200`, with `permissionId`, `changed`, `previousLevel`, `level`, and user information.

### `DELETE /api/documents/{id}/permissions/{permId}`

**Who:** Owner of the document only. Requires same-origin browser write when an `Origin` header is present.

Revokes the specified grant only if it belongs to the document in the URL. Returns `{ "ok": true }`. Subsequent requests re-check the database grant; no long-lived signed download URL is issued.

## Administrative routes

All routes in this section require an administrator account. Administrative read operations are themselves audit-logged. Administrator access to these routes does not bypass the document-content authorization policy.

### `GET /api/admin/users`

Returns up to 200 users with `id`, email, name, role, active status, upload-enabled status and creation time.

### `PATCH /api/admin/users/{userId}`

JSON body must contain at least one allowed field; unknown fields are rejected:

```json
{ "role": "member", "active": true, "uploadEnabled": true }
```

`role` is `admin` or `member`; `active` and `uploadEnabled` are booleans. An administrator cannot modify their own account through this route. Returns `{ "changed": true|false }`.

### `GET /api/admin/documents` and `POST /api/admin/documents` — implementation caveat

The source currently mounts handlers at this path that call `requireUser()`, not `requireAdmin()`. The `GET` handler lists only documents the signed-in caller owns or has an active grant for, with the same `q`, `owner`, `category`, `from`, `to`, `page`, and `pageSize` query parameters as `GET /api/documents`. The `POST` handler accepts `multipart/form-data` with `file` and optional `category` and creates a document owned by the signed-in uploader, subject to the upload-enabled flag. These handlers do not currently enforce administrator-only access despite the `/admin/` path. Treat this as a route-design inconsistency to fix or explicitly account for before submission; do not describe these two handlers as admin-only until their authorization code is changed and tested.

### `GET /api/admin/permissions`

Returns paginated grant history (including revoked grants), newest first. Query parameters: `page`, `pageSize`.

### `GET /api/admin/audit`

Returns paginated audit records. Optional query parameters: `actor` (user UUID), `document` (document UUID), `action`, `outcome` (`allowed` or `denied`), `from`, `to` (`YYYY-MM-DD`), `page`, and `pageSize`.

### `GET /api/admin/audit/verify`

Recomputes the audit hash chain and returns `intact`, `firstBadId`, `head` (`lastId`, `lastHash`, `rowCount`) and `checkedAt`. For stronger evidence against privileged rewriting, retain the reported chain-head hash outside the database.

### `GET /api/admin/flags`

Returns aggregated notable audit events for a time window. Optional `hours` integer from 1 to 720; default `24`.

## Security notes and known boundaries

- This reference describes the current route handlers in the repository; it is not an OpenAPI schema and does not claim independent penetration-test certification.
- The application audit log records many allowed/denied operations, but requests rejected before reaching the route (for example, by a hosting request-size limit) may not appear in the application audit log.
- Audit-chain verification detects inconsistency relative to the records currently present. Preserve chain-head hashes outside the database to help detect removal or rewriting of the newest records by a privileged actor.
- An audit record written before an operation may represent the authorization/attempt rather than successful completion of the subsequent storage or database operation.
- The automated test suite currently covers the pure authorization policy. Run deployed integration/security checks separately for route wiring, Clerk sessions, Supabase, Storage, audit persistence, and revocation timing.
