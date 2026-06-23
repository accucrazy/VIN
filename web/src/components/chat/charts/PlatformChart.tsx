/**
 * PlatformChart Component
 * 
 * 平台分布圖表（圓餅圖 + 橫條圖）
 */

'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import { CHART_COLORS, PLATFORM_COLORS } from './colors';
import type { PlatformData } from './types';

export interface PlatformChartProps {
  data: PlatformData[];
  title?: string;
  showVolume?: boolean;
}

export const PlatformChart = ({ 
  data, 
  title,
  showVolume = false 
}: PlatformChartProps) => {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  
  // Add percentage if not provided
  const chartData = data.map((d, index) => ({
    ...d,
    percentage: d.percentage || (d.count / total * 100),
    color: PLATFORM_COLORS[d.platform.toLowerCase()] || CHART_COLORS[index % CHART_COLORS.length],
  }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-indigo-600" />
        {title || '平台與看板分布分析'}
      </h3>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Pie Chart */}
        <div className="flex-shrink-0">
          <h4 className="text-sm font-medium text-gray-700 mb-2">平台分布</h4>
          <div style={{ width: 180, height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="count"
                  label={({ name, payload }: any) => `${name} ${((payload?.percentage as number) || 0).toFixed(1)}%`}
                  labelLine={false}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bar Chart */}
        <div className="flex-1">
          <h4 className="text-sm font-medium text-gray-700 mb-2">聲量看板排行</h4>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                <YAxis type="category" dataKey="platform" tick={{ fontSize: 11 }} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#6366F1" name="文章數" />
                {showVolume && <Bar dataKey="volume" fill="#F59E0B" name="互動數" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlatformChart;
