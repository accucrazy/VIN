/**
 * Chart Types
 * 
 * 圖表組件共用類型定義
 */

export interface TrendDataPoint {
  date: string;
  volume: number;
  articles: number;
}

export interface TrendDataset {
  label: string;
  data: TrendDataPoint[];
  color?: string;
}

export interface ChartConfig {
  type: 'line' | 'bar' | 'area' | 'pie' | 'composed' | 'multi-line';
  title: string;
  description?: string;
  datasets: {
    label: string;
    dataKey: string;
    color: string;
    type?: 'line' | 'bar' | 'area';
  }[];
  xAxis: {
    dataKey: string;
    label?: string;
  };
  yAxis?: {
    label?: string;
  };
  /** Data snapshot bound to this chart config (for A2A data isolation) */
  data?: any[];
}

export interface HtmlVisualization {
  html: string;
  aspectRatio: '16:9' | '4:3' | '1:1' | 'auto';
  title: string;
}

export interface SentimentData {
  veryPositive: number;
  positive: number;
  neutral: number;
  negative: number;
  veryNegative: number;
  total: number;
}

export interface PlatformData {
  platform: string;
  count: number;
  volume?: number;
  percentage?: number;
}

export interface BrandData {
  brand: string;
  volume: number;
  articles: number;
  color?: string;
}

export interface PostData {
  postId?: string;
  url?: string;
  title?: string;
  content?: string;
  source?: string;
  forumName?: string;
  author?: string;
  likes?: number;
  comments?: number;
  volume?: number;
  pageCreatedAt?: string;
  sentiment?: number;
}
