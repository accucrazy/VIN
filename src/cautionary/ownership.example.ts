// ILLUSTRATIVE — NOT EXECUTED. Nothing here is imported by the harness. See ./README.md.
//
// Ownership: "every row is mine" (the single-user shortcut) vs a runtime ownership boundary.
//
// In single-user, ownership is trivially true — every conversation belongs to the one user. The
// shortcut is to drop the check entirely. The seam the live harness keeps is `verifyOwnership`.

interface Row {
  id: string;
  userId: string;
  content: string;
}

const db: Row[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// THE SHORTCUT — no ownership check (fine when there is exactly one user).
// ─────────────────────────────────────────────────────────────────────────────
function getConversationTrap(conversationId: string): Row | undefined {
  return db.find((r) => r.id === conversationId);
}

// WHERE IT BREAKS: add a second user and this returns anyone's row to anyone.
//   getConversationTrap('bobs-private-thread')  // returns Bob's row to Alice  ← IDOR

// ─────────────────────────────────────────────────────────────────────────────
// THE FIX — ownership is a runtime boundary, enforced in code (not a prompt rule).
// ─────────────────────────────────────────────────────────────────────────────
async function verifyOwnership(conversationId: string, userId: string): Promise<boolean> {
  const row = db.find((r) => r.id === conversationId);
  return !!row && row.userId === userId;
}

async function getConversation(conversationId: string, userId: string): Promise<Row | undefined> {
  if (!(await verifyOwnership(conversationId, userId))) {
    throw new Error('Not found'); // do not reveal existence of rows you do not own
  }
  return db.find((r) => r.id === conversationId && r.userId === userId); // WHERE id AND user_id
}

// The live MemoryAdapter keeps `verifyOwnership(conversationId, userId)` in its interface and
// every query carries `userId`. In single-user that userId is always 'local' and the check is a
// near-no-op — but the boundary exists, so multi-tenant is a config change, not a re-audit.

export {};
