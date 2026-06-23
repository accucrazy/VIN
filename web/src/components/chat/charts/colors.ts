/**
 * Chart Colors
 * 
 * 圖表組件共用顏色配置
 */

export const CHART_COLORS = [
  '#6366F1', // indigo
  '#F59E0B', // amber
  '#10B981', // emerald
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

export const SENTIMENT_COLORS = {
  veryPositive: '#10B981', // emerald
  positive: '#34D399',     // emerald-400
  neutral: '#9CA3AF',      // gray-400
  negative: '#F87171',     // red-400
  veryNegative: '#EF4444', // red
};

export const PLATFORM_COLORS: Record<string, string> = {
  threads: '#EC4899',
  ptt: '#3B82F6',
  dcard: '#06B6D4',
  fb: '#4267B2',
  facebook: '#4267B2',
  instagram: '#E1306C',
  mobile01: '#5CB85C',
};

export const SOURCE_COLORS: Record<string, string> = {
  threads: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
  dcard: 'bg-blue-500 text-white',
  ptt: 'bg-gray-700 text-white',
  fb: 'bg-blue-600 text-white',
  facebook: 'bg-blue-600 text-white',
  instagram: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 text-white',
  mobile01: 'bg-[#5CB85C] text-white',
};

export const getSourceStyle = (source: string): string => {
  const key = source?.toLowerCase() || '';
  return SOURCE_COLORS[key] || 'bg-gray-400 text-white';
};
