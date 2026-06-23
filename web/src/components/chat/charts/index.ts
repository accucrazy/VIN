/**
 * Chat Charts Components
 * 
 * 圖表組件庫統一匯出
 * 模組化重構版本：每個圖表組件獨立檔案
 */

'use client';

// ============================================================
// Types
// ============================================================

export type {
  TrendDataPoint,
  TrendDataset,
  ChartConfig,
  HtmlVisualization,
  SentimentData,
  PlatformData,
  BrandData,
  PostData,
} from './types';

// ============================================================
// Colors (供外部使用)
// ============================================================

export {
  CHART_COLORS,
  SENTIMENT_COLORS,
  PLATFORM_COLORS,
  SOURCE_COLORS,
  getSourceStyle,
} from './colors';

// ============================================================
// Shared Components
// ============================================================

export { CustomTooltip } from './CustomTooltip';

// ============================================================
// Chart Components
// ============================================================

export { TrendChart } from './TrendChart';
export { MultiLineChart } from './MultiLineChart';
export { SentimentChart } from './SentimentChart';
export { PlatformChart } from './PlatformChart';
export { BrandComparisonChart } from './BrandComparisonChart';
export { HtmlVisualizationRenderer } from './HtmlVisualizationRenderer';
export { DynamicChart } from './DynamicChart';
export { PostsTable } from './PostsTable';

// ============================================================
// Default Export (向後兼容)
// ============================================================

export default {
  TrendChart: () => import('./TrendChart').then(m => m.TrendChart),
  MultiLineChart: () => import('./MultiLineChart').then(m => m.MultiLineChart),
  SentimentChart: () => import('./SentimentChart').then(m => m.SentimentChart),
  PlatformChart: () => import('./PlatformChart').then(m => m.PlatformChart),
  BrandComparisonChart: () => import('./BrandComparisonChart').then(m => m.BrandComparisonChart),
  HtmlVisualizationRenderer: () => import('./HtmlVisualizationRenderer').then(m => m.HtmlVisualizationRenderer),
  DynamicChart: () => import('./DynamicChart').then(m => m.DynamicChart),
  PostsTable: () => import('./PostsTable').then(m => m.PostsTable),
};
