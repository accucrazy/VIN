/**
 * TrendChart Component
 * 
 * 單一趨勢圖表（聲量/文章數切換）
 */

'use client';

import React, { useState } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { CustomTooltip } from './CustomTooltip';
import type { TrendDataPoint } from './types';

export interface TrendChartProps {
  data: TrendDataPoint[];
  title?: string;
}

export const TrendChart = ({ data, title }: TrendChartProps) => {
  const [activeTab, setActiveTab] = useState('volume');
  
  const totalVolume = data.reduce((sum, d) => sum + d.volume, 0);
  const totalArticles = data.reduce((sum, d) => sum + d.articles, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          {title || '聲量趨勢分析'}
        </h3>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <div>
            <span className="text-gray-500">總聲量:</span>
            <span className="ml-1 font-semibold text-indigo-600">{totalVolume.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">總文章:</span>
            <span className="ml-1 font-semibold text-gray-800">{totalArticles.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="mb-4">
        <Tabs.List className="flex gap-2">
          <Tabs.Trigger
            value="volume"
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'volume'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            聲量趨勢
          </Tabs.Trigger>
          <Tabs.Trigger
            value="articles"
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'articles'
                ? 'bg-indigo-100 text-indigo-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            文章數
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <defs>
              <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366F1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366F1" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 11, fill: '#6E6E73' }}
              tickFormatter={(v) => {
                if (typeof v !== 'string') return String(v);
                // 小時 bucket：'YYYY-MM-DD HH:00'（或 ISO 'YYYY-MM-DDTHH'）→ 'MM-DD HH:00'
                const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(v);
                if (m) return `${m[2]}-${m[3]} ${m[4]}:00`;
                // 日 bucket：'YYYY-MM-DD' → 'MM-DD'（向下相容 analyze_brand）
                return v.length >= 10 ? v.slice(5, 10) : v;
              }}
            />
            <YAxis 
              tick={{ fontSize: 11, fill: '#6E6E73' }}
              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v}
            />
            <Tooltip content={<CustomTooltip />} />
            {activeTab === 'volume' ? (
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#6366F1"
                strokeWidth={2}
                fill="url(#volumeGradient)"
                name="聲量"
              />
            ) : (
              <Bar dataKey="articles" fill="#6366F1" opacity={0.7} name="文章數" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TrendChart;
