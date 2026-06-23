// ILLUSTRATIVE — NOT EXECUTED. Nothing here is imported by the harness. See ./README.md.
//
// Metering: the same `reserve → delta → finalize` accounting serves two purposes.
//   - single-user: a local SPEND METER (observability; optionally a soft cap).
//   - multi-tenant: a per-UID QUOTA GATE (429/503 when a tenant exceeds its budget).
//
// The accounting mechanism is identical; only the *gate* is added/removed. The live harness keeps
// the accounting (AgentRunUsage / UsageDelta) and collapses the gate away for single-user.

interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ACCOUNTING — reserve → delta → finalize (kept in BOTH forms).
// ─────────────────────────────────────────────────────────────────────────────
class SpendMeter {
  private spent: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  /** Optimistically reserve before a call so a mid-run crash still books the estimate. */
  reserve(estCostUsd: number): { settle: (actual: Usage) => void } {
    this.spent.costUsd += estCostUsd; // reserved
    return {
      settle: (actual) => {
        // finalize: replace the estimate with the measured delta.
        this.spent.costUsd += actual.costUsd - estCostUsd;
        this.spent.inputTokens += actual.inputTokens;
        this.spent.outputTokens += actual.outputTokens;
      },
    };
  }

  total(): Usage {
    return { ...this.spent };
  }
}

// SINGLE-USER: this is all you need — a dashboard number. No gate.
//   const meter = new SpendMeter();
//   const r = meter.reserve(0.01); ... r.settle(measured);
//   console.log('spent so far', meter.total().costUsd);

// ─────────────────────────────────────────────────────────────────────────────
// THE GATE — multi-tenant only. WHERE single-user "no gate" breaks: one tenant
// can exhaust a shared budget and starve everyone else.
// ─────────────────────────────────────────────────────────────────────────────
class QuotaError extends Error {
  constructor(public readonly httpStatus: 429 | 503) {
    super('quota exceeded');
  }
}

function checkQuota(perUserSpent: Map<string, number>, userId: string, monthlyCapUsd: number) {
  if ((perUserSpent.get(userId) ?? 0) >= monthlyCapUsd) {
    throw new QuotaError(429); // reject before doing the work
  }
}

// The live harness ships the SpendMeter accounting (as AgentRunUsage / UsageDelta in
// src/types.ts) and leaves `checkQuota` OUT for single-user. Re-introducing the per-UID gate is
// additive — the accounting it depends on is already there.

export {};
