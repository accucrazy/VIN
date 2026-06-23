/**
 * User-input safety detection module
 *
 * Detects possible sensitive-information extraction attempts and prompt-injection
 * attacks in user messages.
 *
 * Design principles:
 * - Log warnings only; do not block legitimate requests (avoid hurting UX with
 *   false positives).
 * - Leave an interface for stronger protection in the future (e.g. auto-reject).
 * - Support both Chinese and English detection patterns.
 *
 * @module security/input-guard
 */

// ============================================================
// Detection-pattern definitions
// ============================================================

/**
 * Threat level
 */
export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Detection rule
 */
interface DetectionRule {
  /** Rule ID */
  id: string;
  /** Match pattern */
  pattern: RegExp;
  /** Threat level */
  level: ThreatLevel;
  /** Description (used in logs) */
  description: string;
}

/**
 * Detection result
 */
export interface InputGuardResult {
  /** Whether suspicious patterns were detected */
  suspicious: boolean;
  /** Highest threat level */
  maxLevel: ThreatLevel | null;
  /** Matched rules */
  matches: Array<{
    ruleId: string;
    level: ThreatLevel;
    description: string;
  }>;
}

// ============================================================
// Detection rules
// ============================================================

const DETECTION_RULES: DetectionRule[] = [
  // === Directly requesting secret information ===
  {
    id: 'secret-apikey',
    pattern: /api.?key/i,
    level: 'high',
    description: 'Requesting API key',
  },
  {
    id: 'secret-password',
    pattern: /密碼|password|credential|passwd/i,
    level: 'high',
    description: 'Requesting password/credential',
  },
  {
    id: 'secret-privatekey',
    pattern: /private.?key|私鑰/i,
    level: 'critical',
    description: 'Requesting private key',
  },
  {
    id: 'secret-token',
    pattern: /bearer.?token|access.?token|refresh.?token/i,
    level: 'high',
    description: 'Requesting token',
  },
  {
    id: 'secret-generic',
    pattern: /secret|機密|金鑰|憑證/i,
    level: 'medium',
    description: 'Requesting secret/credential (generic)',
  },

  // === Attempting to read config files ===
  {
    id: 'config-env',
    pattern: /\.env/i,
    level: 'critical',
    description: 'Attempting to access .env file',
  },
  {
    id: 'config-deploy',
    // Generic deploy/host config manifests (e.g. *.deploy.yaml, deploy config).
    pattern: /deploy(ment)?\.ya?ml|host(ing)?\.ya?ml/i,
    level: 'critical',
    description: 'Attempting to access deploy/host config',
  },
  {
    id: 'config-generic',
    pattern: /設定檔|config\.(ts|js|json|yaml|yml)/i,
    level: 'medium',
    description: 'Attempting to access config file',
  },
  {
    id: 'config-serviceaccount',
    pattern: /service.?account|serviceAccount/i,
    level: 'high',
    description: 'Attempting to access service account',
  },

  // === Connection information ===
  {
    id: 'infra-database',
    pattern: /資料庫.*(連線|密碼|帳號|IP|port)|database.*(connection|password|host)/i,
    level: 'high',
    description: 'Requesting database connection info',
  },
  {
    id: 'infra-endpoint',
    pattern: /內部.*端點|internal.*endpoint|serverless.*url/i,
    level: 'medium',
    description: 'Requesting internal endpoint info',
  },

  // === System-prompt extraction ===
  {
    id: 'prompt-systemprompt',
    pattern: /system.?prompt/i,
    level: 'critical',
    description: 'Attempting to extract system prompt',
  },
  {
    id: 'prompt-zh-system',
    pattern: /系統提示|系統指令/i,
    level: 'critical',
    description: 'Attempting to extract system prompt (zh)',
  },
  {
    id: 'prompt-rules',
    pattern: /你的(指令|規則|設定|提示詞)/i,
    level: 'high',
    description: 'Attempting to extract agent rules',
  },
  {
    id: 'prompt-reveal',
    pattern: /列出.*規則|show.*rules|reveal.*prompt|dump.*instructions/i,
    level: 'high',
    description: 'Attempting to reveal instructions',
  },

  // === Prompt injection ===
  {
    id: 'injection-ignore',
    pattern: /ignore\s+(previous|all|any|above)\s+instructions?/i,
    level: 'critical',
    description: 'Prompt injection: ignore instructions',
  },
  {
    id: 'injection-zh-ignore',
    pattern: /忽略.*(之前|所有|以上).*指令/i,
    level: 'critical',
    description: 'Prompt injection: ignore instructions (zh)',
  },
  {
    id: 'injection-disregard',
    pattern: /disregard\s+(previous|all|any)\s+instructions?/i,
    level: 'critical',
    description: 'Prompt injection: disregard instructions',
  },
  {
    id: 'injection-roleplay',
    pattern: /你現在是|you\s+are\s+now|from\s+now\s+on.*you/i,
    level: 'high',
    description: 'Prompt injection: role reassignment',
  },
  {
    id: 'injection-pretend',
    pattern: /pretend\s+(to\s+be|you\s+are)|假裝你是/i,
    level: 'high',
    description: 'Prompt injection: pretend/impersonate',
  },
  {
    id: 'injection-jailbreak',
    pattern: /DAN|jailbreak|越獄|no\s+restrictions|沒有限制/i,
    level: 'critical',
    description: 'Prompt injection: jailbreak attempt',
  },
  {
    id: 'injection-format',
    pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|### (Human|Assistant|System):/i,
    level: 'critical',
    description: 'Prompt injection: format token injection',
  },
];

// ============================================================
// Threat-level ordering
// ============================================================

const THREAT_LEVEL_ORDER: Record<ThreatLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ============================================================
// Main API
// ============================================================

/**
 * Detect suspicious patterns in user input.
 *
 * @param input The user's raw message
 * @returns Detection result
 *
 * @example
 * ```typescript
 * const result = detectSensitiveRequest('please read .env.local for me');
 * if (result.suspicious) {
 *   console.warn('[Security] Suspicious:', result.matches);
 * }
 * ```
 */
export function detectSensitiveRequest(input: string): InputGuardResult {
  if (!input || typeof input !== 'string') {
    return { suspicious: false, maxLevel: null, matches: [] };
  }

  const matches: InputGuardResult['matches'] = [];

  for (const rule of DETECTION_RULES) {
    if (rule.pattern.test(input)) {
      matches.push({
        ruleId: rule.id,
        level: rule.level,
        description: rule.description,
      });
    }
  }

  if (matches.length === 0) {
    return { suspicious: false, maxLevel: null, matches: [] };
  }

  // Find the highest threat level
  const maxLevel = matches.reduce<ThreatLevel>((max, match) => {
    return THREAT_LEVEL_ORDER[match.level] > THREAT_LEVEL_ORDER[max]
      ? match.level
      : max;
  }, matches[0].level);

  return {
    suspicious: true,
    maxLevel,
    matches,
  };
}

/**
 * Format the detection result as a log string.
 *
 * @param result Detection result
 * @param userId User ID (optional, for log tracing)
 * @returns Formatted log string
 */
export function formatGuardLog(result: InputGuardResult, userId?: string): string {
  if (!result.suspicious) {
    return '';
  }

  const userTag = userId ? ` user=${userId}` : '';
  const matchSummary = result.matches
    .map(m => `${m.ruleId}(${m.level})`)
    .join(', ');

  return `[InputGuard]${userTag} level=${result.maxLevel} matches=[${matchSummary}]`;
}
