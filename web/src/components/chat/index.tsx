/**
 * Chat Components Export (VIN trimmed barrel)
 *
 * 從 the-pocket-pandora 移植時刻意拔掉的：
 *   - ToolExecution      → 跟後端 SSE event 深度耦合，沒搬
 *   - GoogleMapsWidget   → 需要 GCP API key + 額外授權，沒搬
 *
 * 這兩個拔掉後，凡是吃 `chunk.type === 'tool_execution'` 的分支會走 placeholder。
 */

// 圖表組件
export {
  TrendChart,
  MultiLineChart,
  SentimentChart,
  PlatformChart,
  BrandComparisonChart,
  HtmlVisualizationRenderer,
  DynamicChart,
  PostsTable,
} from './charts';

export type {
  TrendDataPoint,
  TrendDataset,
  ChartConfig,
  HtmlVisualization,
  SentimentData,
  PlatformData,
  BrandData,
  PostData,
} from './charts';

// ToolCall type 原本從 ToolExecution.tsx 匯出 — ToolExecution 沒搬，
// 但 type 還是要存在（chat/hooks/types.ts 跟整個 chat UI 都依賴它）。
// 這裡用一份精簡的本地定義，跟上游 ToolExecution.tsx 的 ToolCall shape 對齊。
export interface ToolCall {
  tool: string;
  input?: any;
  output?: any;
  thought?: string;
  timestamp?: string;
  duration?: number;
  progress?: { current: number; total: number; message?: string } | any;
  /** A2A: agent id that originated this tool call */
  agentId?: string;
  /** A2A: agent display name */
  agentName?: string;
  /** web_search: which backend served the result (tavily/browser/...) */
  provider?: string;
}
