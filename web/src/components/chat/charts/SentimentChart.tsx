/**
 * SentimentChart Component
 * 
 * 情緒分布圓餅圖
 */

'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';
import { SENTIMENT_COLORS } from './colors';
import type { SentimentData } from './types';

export interface SentimentChartProps {
  data: SentimentData;
  title?: string;
}

export const SentimentChart = ({ data, title }: SentimentChartProps) => {
  const chartData = [
    { name: '非常正面', value: data.veryPositive, color: SENTIMENT_COLORS.veryPositive },
    { name: '正面', value: data.positive, color: SENTIMENT_COLORS.positive },
    { name: '中性', value: data.neutral, color: SENTIMENT_COLORS.neutral },
    { name: '負面', value: data.negative, color: SENTIMENT_COLORS.negative },
    { name: '非常負面', value: data.veryNegative, color: SENTIMENT_COLORS.veryNegative },
  ].filter(d => d.value > 0);

  const total = data.total || chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
        <PieIcon className="w-5 h-5 text-indigo-600" />
        {title || '情緒分布概覽'}
      </h3>

      <div className="flex flex-col md:flex-row items-center gap-6">
        {/* Pie Chart */}
        <div style={{ width: 200, height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={((value: number) => [
                  `${value.toLocaleString()} (${((value / total) * 100).toFixed(1)}%)`,
                  '',
                ]) as any}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2">
          {chartData.map((entry, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: entry.color }} 
                />
                <span className="text-sm text-gray-700">{entry.name}</span>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {((entry.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
          <div className="pt-2 border-t border-gray-200 text-center">
            <span className="text-xs text-gray-500">情緒分布</span>
            <span className="ml-2 text-sm font-semibold text-gray-800">
              共 {total.toLocaleString()} 篇
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SentimentChart;
