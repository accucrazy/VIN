/**
 * MultiLineChart Component
 * 
 * 多線比較圖表（品牌/關鍵字對比）
 */

'use client';

import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import { CHART_COLORS } from './colors';
import type { TrendDataset, ChartConfig } from './types';

export interface MultiLineChartProps {
  datasets: TrendDataset[];
  chartConfig?: ChartConfig;
  tabs?: string[];
}

export const MultiLineChart = ({ 
  datasets, 
  chartConfig,
  tabs = ['volume', 'articles']
}: MultiLineChartProps) => {
  const [activeMetric, setActiveMetric] = useState(tabs[0]);
  
  // 合併所有數據集到同一個數據陣列
  const allDates = new Set<string>();
  datasets.forEach(ds => ds.data.forEach(d => allDates.add(d.date)));
  const sortedDates = Array.from(allDates).sort();
  
  const chartData = sortedDates.map(date => {
    const point: Record<string, any> = { date };
    datasets.forEach((ds, idx) => {
      const found = ds.data.find(d => d.date === date);
      point[`volume_${idx}`] = found?.volume || 0;
      point[`articles_${idx}`] = found?.articles || 0;
    });
    return point;
  });

  const metricLabels: Record<string, string> = {
    volume: '總聲量趨勢',
    articles: '文章數趨勢',
    positive: '正評聲量趨勢',
    negative: '負評聲量趨勢',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          {chartConfig?.title || '聲量趨勢分析'}
        </h3>
        {chartConfig?.description && (
          <p className="text-xs text-gray-500">{chartConfig.description}</p>
        )}
      </div>

      {/* Tab 切換 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveMetric(tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeMetric === tab
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {metricLabels[tab] || tab}
          </button>
        ))}
      </div>

      {/* 圖例 */}
      <div className="flex flex-wrap gap-4 mb-4">
        {datasets.map((ds, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: ds.color || CHART_COLORS[idx % CHART_COLORS.length] }} 
            />
            <span className="text-xs text-gray-600">{ds.label}</span>
          </div>
        ))}
      </div>

      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 11, fill: '#6E6E73' }}
              tickFormatter={(v) => v.slice(5)}
            />
            <YAxis 
              tick={{ fontSize: 11, fill: '#6E6E73' }}
              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
            />
            <Tooltip content={<CustomTooltip />} />
            {datasets.map((ds, idx) => (
              <Line
                key={idx}
                type="monotone"
                dataKey={`${activeMetric}_${idx}`}
                stroke={ds.color || CHART_COLORS[idx % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                name={`${ds.label} ${metricLabels[activeMetric] || activeMetric}`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default MultiLineChart;
