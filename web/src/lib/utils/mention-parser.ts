/**
 * Mention Parser
 * 
 * 解析用戶輸入中的 @Agent mentions，提取目標 Agent 和對應任務
 */

/**
 * 解析後的 Mention 結構
 */
export interface ParsedMention {
  agentId: string;
  agentName: string;
  task: string;
}

/**
 * 解析結果
 */
export interface MentionParseResult {
  /** 解析出的 mentions 列表 */
  mentions: ParsedMention[];
  /** 是否有有效的 mentions */
  hasMentions: boolean;
  /** 原始輸入（去除 @mention 標記後的純文字，用於無 mention 時的 fallback） */
  rawMessage: string;
}

/**
 * Agent 名稱對照表（name -> id）— 對齊 VIN 的 agent registry。
 */
const AGENT_NAME_TO_ID: Record<string, string> = {
  'vin': 'vin',
  'researcher': 'researcher',
};

/**
 * Agent ID 對照表（id -> name）
 */
const AGENT_ID_TO_NAME: Record<string, string> = {
  'vin': 'Vin',
  'researcher': 'Researcher',
};

/**
 * 解析輸入中的 @Agent mentions
 * 
 * 支援格式：
 * - 單行：@Pandora 幫我分析雄獅的輿情
 * - 多行：
 *   @Pandora 分析輿情
 *   @Paul 分析CRM
 *   @Stacey 統整報告
 * 
 * @param input 用戶輸入
 * @returns 解析結果
 */
export function parseMentions(input: string): MentionParseResult {
  const mentions: ParsedMention[] = [];
  
  // 正則：匹配 @AgentName 後面的任務（直到下一個 @AgentName 或字串結尾）
  // 使用 lookahead 來處理多個 mention 的情況
  const mentionRegex = /@(vin|researcher)\s+(.+?)(?=@(?:vin|researcher)\s+|$)/gis;
  
  let match;
  while ((match = mentionRegex.exec(input)) !== null) {
    const agentNameRaw = match[1].toLowerCase();
    const task = match[2].trim();
    
    const agentId = AGENT_NAME_TO_ID[agentNameRaw];
    const agentName = AGENT_ID_TO_NAME[agentId];
    
    if (agentId && task) {
      mentions.push({
        agentId,
        agentName,
        task,
      });
    }
  }
  
  // 計算 rawMessage（移除所有 @mention 標記）
  const rawMessage = input
    .replace(/@(vin|researcher)\s*/gi, '')
    .trim();
  
  return {
    mentions,
    hasMentions: mentions.length > 0,
    rawMessage,
  };
}

/**
 * 檢測輸入是否包含 @Agent mention
 * 快速檢測，不做完整解析
 */
export function hasMentions(input: string): boolean {
  return /@(vin|researcher)\b/i.test(input);
}

/**
 * 從解析結果中提取目標 Agent IDs
 */
export function getTargetAgentIds(result: MentionParseResult): string[] {
  return result.mentions.map(m => m.agentId);
}

/**
 * 判斷是否需要並行執行
 * 當有多個 mention 且不包含 Stacey 時，可以並行執行
 */
export function shouldParallelExecute(result: MentionParseResult): boolean {
  if (result.mentions.length <= 1) return false;

  // 如果包含 Vin（host orchestrator），可能有依賴關係，不自動並行
  const hasOrchestrator = result.mentions.some(m => m.agentId === 'vin');
  return !hasOrchestrator;
}

/**
 * 建立 API 請求的 targetAgents 參數
 */
export function buildTargetAgents(result: MentionParseResult): Array<{
  agentId: string;
  task: string;
}> | null {
  if (!result.hasMentions) return null;
  
  return result.mentions.map(m => ({
    agentId: m.agentId,
    task: m.task,
  }));
}
