/**
 * Chat Types (VIN web UI)
 * 
 * Pandora 專用的聊天類型定義
 * 使用 components/chat 的類型保持 UI 相容性
 */

'use client';

// 從 components/chat 匯入 UI 類型
import type {
  ToolCall,
  TrendDataPoint,
  TrendDataset,
  ChartConfig,
  HtmlVisualization,
} from '@/components/chat';

// 重新匯出
export type { ToolCall, TrendDataPoint, TrendDataset, ChartConfig, HtmlVisualization };

// 原本 `SSEEventHandlers` 由 @/tpc-ai/client 提供（the-pocket-pandora 的 SDK），
// VIN 不依賴該 SDK。如果你之後接自己的 SSE 後端，請在此補上對應 type 或
// 改 import 自己的 SSE client。先給最小版本以維持下游 type 相容。
export interface SSEEventHandlers {
  [eventName: string]: ((data: any) => void) | undefined;
}

/**
 * 訊息內容區塊
 */
export interface MessageContent {
  type: 'text' | 'schema' | 'data' | 'sql' | 'chart' | 'error' | 'tool_execution' | 'unknown';
  content: any;
  chartConfig?: ChartConfig;
  htmlVisualization?: HtmlVisualization;
}

/**
 * 聊天訊息
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  chunks?: MessageContent[];
  timestamp: Date;
  toolCalls?: ToolCall[];
  sql?: string;
  data?: any[];
  trendData?: TrendDataPoint[];
  trendDatasets?: TrendDataset[];
  /** 多品牌/多查詢並行時各查詢獨立的文章組（供前端 tab 切換文章列表） */
  searchResultsByQuery?: Array<{ queryLabel: string; question: string; data: any[] }>;
  threadsData?: any[];
  chartConfig?: ChartConfig;
  chartConfigs?: ChartConfig[];
  htmlVisualization?: HtmlVisualization;
  htmlVisualizations?: HtmlVisualization[];
  /** Agent 最終推理思考（給用戶看的總結性思考） */
  thought?: string;
  /** A2A: 發出此訊息的 Agent ID（host / pandora / moana） */
  agentId?: string;
  /** A2A: 發出此訊息的 Agent 顯示名稱（Stacey / Pandora / Moana） */
  agentName?: string;
  /** A2A: Host Agent 的 Review 氣泡標記（顯示 "Reviewing" 標示） */
  isReview?: boolean;
  /** A2A: Review 已完成標記（轉換為 "Reviewed" 狀態） */
  isReviewComplete?: boolean;
  /** A2A: 並行執行組 ID（同組 agents 會並排顯示） */
  parallelGroupId?: string;
  /** 數據過期標記（90 天 TTL 後數據不可見） */
  dataExpired?: boolean;
  /** 排隊中標記（系統忙碌時訊息已入佇列，等待 task 輪詢補上答案） */
  status?: 'queued';
}

/**
 * 對話列表項目
 */
export interface ConversationListItem {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * SSE 事件類型
 */
export type SSEEventType = 
  | 'tool_start' 
  | 'tool_complete' 
  | 'tool_call' 
  | 'complete' 
  | 'error' 
  | 'thinking'
  | 'model_info'  // 模型選擇資訊（深度思考通知）
  // A2A Agent Identity Events
  | 'agent_start'
  | 'agent_complete'
  | 'agent_tool_start'
  | 'agent_tool_complete'
  | 'agent_tool_call'
  | 'agent_thinking'
  | 'agent_output';  // Agent 中間輸出（continue action）
