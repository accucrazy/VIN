// Runtime-enforced, identity-independent. Single-user needs this exactly as much as multi-tenant.
/**
 * Content Scan — scan for writes into long-term memory / skills
 *
 * Defends against "persistent prompt injection": poisoned long-term memory (LTM)
 * or user skills get pulled into the system prompt automatically on every session,
 * which is more dangerous than a one-shot input injection.
 * Write-point scanning (this module) + read-point sanitization together form a
 * defense-in-depth posture.
 *
 * Pattern trade-offs (precision first — avoid false positives on legitimate
 * marketing/analytics content):
 * - BLOCK set = high-precision injection patterns: zh/en instruction overrides,
 *   system-prompt manipulation, role reassignment, format tokens, and forgery of
 *   our own fence tags.
 * - Deliberately excluded: `[[...]]` (marketing templates like [[brand_name]] are
 *   normal), secret/config keywords (memory like "client requested a password-policy
 *   report" is legitimate content), and bare "DAN"/"no restrictions" (high false
 *   positive rate — see the lesson in input-guard).
 */

/** Write-block patterns (a match means the write is rejected) */
const BLOCK_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  // === Instruction override (en): modifier chain covers "ignore all previous instructions" etc. ===
  { id: 'ignore-instructions', pattern: /\b(ignore|disregard|forget|override)\s+(all|any|previous|prior|earlier|above|the)(\s+(all|any|previous|prior|earlier|above|the))*\s+instructions?/i },

  // === Instruction override (zh) ===
  { id: 'zh-ignore-instructions', pattern: /忽略.{0,8}(之前|所有|以上).{0,8}(指令|規則|提示)/ },
  { id: 'zh-override-instructions', pattern: /(無視|不要理會|不用遵守).{0,8}(指令|規則|限制)/ },

  // === System-prompt manipulation ===
  { id: 'system-override', pattern: /new\s+system\s+prompt|system\s+(prompt\s+)?override/i },

  // === Role reassignment (persistent memory should never contain this sentence shape) ===
  { id: 'role-reassign', pattern: /you\s+are\s+now\s+a|from\s+now\s+on[,，]?\s*you\s+(are|will)/i },
  { id: 'zh-role-reassign', pattern: /你現在是.{0,12}(助理|機器人|AI|模型|agent)|假裝你是/i },

  // === Format-token injection ===
  { id: 'format-token', pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|### (Human|Assistant|System):/i },

  // === Forgery of our own fence tags (could masquerade as authoritative injected content at the read side) ===
  { id: 'fence-forgery', pattern: /<\/?(user-preferences|relevant-past-conversations)>/i },
  { id: 'boundary-forgery', pattern: /<<<\s*\/?\s*(END_)?EXTERNAL_UNTRUSTED_CONTENT\s*>>>/i },
];

/** Our own fence tags to strip at the read side (legacy data may already contain them) */
const FENCE_TAG_PATTERN = /<\/?(user-preferences|relevant-past-conversations)>/gi;

export interface ContentScanResult {
  /** Whether the write should be rejected */
  blocked: boolean;
  /** List of matched pattern IDs */
  matches: string[];
}

/**
 * Scan content about to be written to long-term storage (LTM / user skill).
 *
 * @param content The content to write
 * @returns When blocked=true, the caller should reject the write and log matches
 */
export function scanMemoryWrite(content: string): ContentScanResult {
  if (!content) {
    return { blocked: false, matches: [] };
  }
  const matches: string[] = [];
  for (const { id, pattern } of BLOCK_PATTERNS) {
    if (pattern.test(content)) {
      matches.push(id);
    }
  }
  return { blocked: matches.length > 0, matches };
}

/**
 * Read-side sanitization: strip our own fence tags (prevents legacy poisoned data
 * from masquerading as an authoritative block during injection).
 */
export function stripFenceTags(content: string): string {
  if (!content) return content;
  return content.replace(FENCE_TAG_PATTERN, '');
}

/**
 * Format a scan log line (same style as input-guard's formatGuardLog).
 */
export function formatScanLog(result: ContentScanResult, context: string): string {
  if (!result.blocked) return '';
  return `[ContentScan] blocked ${context} matches=[${result.matches.join(', ')}]`;
}
