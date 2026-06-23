/**
 * CustomTooltip Component
 * 
 * Recharts 共用 Tooltip 組件
 */

'use client';

import React from 'react';

export interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

export const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  
  return (
    <div className="bg-white border border-gray-300 rounded-lg p-3 shadow-md">
      <p className="text-sm font-medium text-gray-900 mb-2">{label}</p>
      {payload.map((entry: any, index: number) => (
        <p key={index} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
};

export default CustomTooltip;
