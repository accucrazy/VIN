/**
 * BrandComparisonChart Component
 * 
 * 品牌聲量比較長條圖
 */

'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import { CHART_COLORS } from './colors';
import type { BrandData } from './types';

export interface BrandComparisonChartProps {
  data: BrandData[];
  title?: string;
}

export const BrandComparisonChart = ({ 
  data, 
  title 
}: BrandComparisonChartProps) => {
  const chartData = data.map((d, idx) => ({
    ...d,
    color: d.color || CHART_COLORS[idx % CHART_COLORS.length],
  }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-indigo-600" />
        {title || '品牌聲量比較'}
      </h3>

      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="brand" tick={{ fontSize: 11 }} />
            <YAxis 
              yAxisId="left" 
              tick={{ fontSize: 10 }} 
              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
              label={{ value: '聲量', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <YAxis 
              yAxisId="right" 
              orientation="right" 
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
              label={{ value: '文章數', angle: 90, position: 'insideRight', fontSize: 11 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar yAxisId="left" dataKey="volume" name="聲量" fill="#6366F1" />
            <Bar yAxisId="right" dataKey="articles" name="文章數" fill="#F59E0B" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default BrandComparisonChart;
