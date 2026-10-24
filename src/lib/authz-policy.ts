/**
 * THE RULES. Pure function: no database, no network, no framework imports.
 * Same inputs always give the same answer, so it is easy to read, explain and test.
 *
 * Principle: DEFAULT DENY. The only way to get { allowed: true } is to match
 * one of the explicit "allow" lines below. Anything unexpected falls through
 * to a denial at the bottom.
 *
 * Note what is NOT here: there is no "admin" rule. Administrators get no
 * special access to file contents (decision D6). They see metadata and audit
 * data through separate admin routes.
 */

export type DocAction = "read" | "edit" | "delete" | "share";
export type GrantLevel = "read" | "edit";
export type AccessKind = "owner" | "edit" | "read";

export type PolicyDoc = { ownerId: string; deletedAt: string | null };
export type PolicyGrant = { level: GrantLevel; revokedAt: string | null };

export type DenyReason =
  | "invalid_id"
  | "no_such_document"
  | "deleted"
  | "no_grant"
  | "insufficient_level";

export type Decision =
  | { allowed: true; access: AccessKind }
  | { allowed: false; reason: DenyReason };

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

export function decide(input: {
  userId: string;
  doc: PolicyDoc | null;
  grant: PolicyGrant | null;
  action: DocAction;
}): Decision {
  const { userId, doc, grant, action } = input;

  if (!userId) return deny("no_grant");
  if (!doc) return deny("no_such_document");

  // Soft-deleted documents are unreachable for EVERYONE, owner included.
  if (doc.deletedAt !== null) return deny("deleted");

  // The owner may do everything to their own document.
  if (doc.ownerId === userId) return { allowed: true, access: "owner" };

  // Everyone else needs an ACTIVE grant. (The query already excludes revoked
  // grants; checking revokedAt again here is a second, independent lock.)
  if (!grant || grant.revokedAt !== null) return deny("no_grant");

  switch (action) {
    case "read":
      // 'edit' includes 'read'.
      if (grant.level === "read" || grant.level === "edit") {
        return { allowed: true, access: grant.level };
      }
      return deny("insufficient_level");

    case "edit":
      if (grant.level === "edit") return { allowed: true, access: "edit" };
      return deny("insufficient_level");

    // Only the owner may delete or re-share. Grantees never can.
    case "delete":
    case "share":
      return deny("insufficient_level");
  }

  // Unknown action (should be impossible in typed code): deny.
  return deny("insufficient_level");
}