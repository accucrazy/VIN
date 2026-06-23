// ILLUSTRATIVE — NOT EXECUTED. Nothing here is imported by the harness. See ./README.md.
//
// Identity: global singleton (the trap) vs per-call context + loud-fail (the fix).
//
// Single-user makes a global `currentUserId` *look* fine — there is only one user. It is the
// single most dangerous shortcut to copy into a long-lived multi-request process.

// ─────────────────────────────────────────────────────────────────────────────
// THE TRAP — a process-global identity.
// ─────────────────────────────────────────────────────────────────────────────
let currentUserId: string | null = null;

function setCurrentUser(id: string) {
  currentUserId = id;
}

async function loadUserMemoryTrap(): Promise<string> {
  // Reads ambient global state — whatever the *last* setCurrentUser happened to set.
  return `memory for ${currentUserId}`;
}

// WHERE IT BREAKS: two concurrent requests in one long-lived process interleave.
//   req A: setCurrentUser('alice');           // currentUserId = 'alice'
//   req B: setCurrentUser('bob');             // currentUserId = 'bob'   (clobbers A)
//   req A: await loadUserMemoryTrap();         // returns BOB's memory to ALICE  ← leak
// In a single-user demo this never fires. In production it is a cross-tenant data breach.

// ─────────────────────────────────────────────────────────────────────────────
// THE FIX — identity travels with the call; absence fails loudly.
// ─────────────────────────────────────────────────────────────────────────────
interface CallContext {
  userId?: string;
}

async function loadUserMemory(ctx: CallContext): Promise<string> {
  // loud-fail over silent-fallback: a missing identity is a bug, not a default.
  if (!ctx.userId) {
    throw new Error('loadUserMemory: ctx.userId is required (no global fallback).');
  }
  return `memory for ${ctx.userId}`;
}

// This is exactly the shape the LIVE harness uses: AgentTool.execute(args, context),
// react-loop threads `{ userId }`, memory tools read `context.userId`. In single-user it is
// always 'local' — but it is a SEAM, never a constant, so concurrency can never leak.

export {}; // not a module anyone imports; keeps this file self-contained.
