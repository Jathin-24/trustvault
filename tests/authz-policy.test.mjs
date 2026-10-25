import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/lib/authz-policy.ts';

// Run with Node's built-in TypeScript type stripping; no extra test framework
// or runtime dependency is required. These tests cover the pure policy only,
// not the route handlers or deployed Clerk/Supabase/Storage integrations.

const doc = (overrides = {}) => ({ ownerId: 'owner-1', deletedAt: null, ...overrides });
const grant = (level = 'read', overrides = {}) => ({ level, revokedAt: null, ...overrides });
const decision = (userId, action, document = doc(), permission = null) =>
  decide({ userId, action, doc: document, grant: permission });

test('owner can read, edit, delete, and share their own active document', () => {
  for (const action of ['read', 'edit', 'delete', 'share']) {
    assert.deepEqual(decision('owner-1', action), { allowed: true, access: 'owner' }, action);
  }
});

test('read grant permits reading only', () => {
  assert.deepEqual(decision('viewer-1', 'read', doc(), grant('read')), { allowed: true, access: 'read' });
  for (const action of ['edit', 'delete', 'share']) {
    assert.equal(decision('viewer-1', action, doc(), grant('read')).allowed, false, action);
  }
});

test('edit grant permits reading and editing, but not deleting or re-sharing', () => {
  assert.deepEqual(decision('editor-1', 'read', doc(), grant('edit')), { allowed: true, access: 'edit' });
  assert.deepEqual(decision('editor-1', 'edit', doc(), grant('edit')), { allowed: true, access: 'edit' });
  assert.equal(decision('editor-1', 'delete', doc(), grant('edit')).allowed, false);
  assert.equal(decision('editor-1', 'share', doc(), grant('edit')).allowed, false);
});

test('no grant is denied for every action by a non-owner', () => {
  for (const action of ['read', 'edit', 'delete', 'share']) {
    assert.equal(decision('stranger-1', action).allowed, false, action);
  }
});

test('revoked grants are denied even if a grant object is supplied', () => {
  const revoked = grant('edit', { revokedAt: '2026-10-25T10:00:00.000Z' });
  for (const action of ['read', 'edit', 'delete', 'share']) {
    assert.equal(decision('former-viewer', action, doc(), revoked).allowed, false, action);
  }
});

test('deleted documents are denied to owners and grantees', () => {
  const deleted = doc({ deletedAt: '2026-10-25T10:00:00.000Z' });
  assert.deepEqual(decision('owner-1', 'read', deleted), { allowed: false, reason: 'deleted' });
  assert.deepEqual(decision('viewer-1', 'read', deleted, grant('read')), { allowed: false, reason: 'deleted' });
});

test('missing document is denied', () => {
  assert.deepEqual(decision('viewer-1', 'read', null, grant('read')), { allowed: false, reason: 'no_such_document' });
});

test('missing user is denied even when a document and grant are supplied', () => {
  assert.deepEqual(decision('', 'read', doc(), grant('read')), { allowed: false, reason: 'no_grant' });
});

test('administrator identity alone does not bypass document grants', () => {
  // The policy intentionally has no admin override; admin metadata access is separate.
  assert.deepEqual(decision('admin-1', 'read'), { allowed: false, reason: 'no_grant' });
});

test('unknown action fails closed at runtime', () => {
  assert.deepEqual(decision('viewer-1', 'export', doc(), grant('edit')), { allowed: false, reason: 'insufficient_level' });
});
