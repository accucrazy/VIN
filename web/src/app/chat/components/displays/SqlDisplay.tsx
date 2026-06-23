/**
 * SqlDisplay Component
 * 
 * 顯示生成的 SQL 查詢（可收折）
 */

'use client';

import React, { useState } from 'react';

export function SqlDisplay({ sql }: { sql: string | null }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!sql) return null;

  return (
    <div className="my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
      >
        <svg
          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Generated SQL</span>
      </button>
      {isExpanded && (
        <pre className="mt-2 p-3 bg-gray-900 text-green-400 rounded-lg text-xs overflow-x-auto font-mono">
          {sql}
        </pre>
      )}
    </div>
  );
}

export default SqlDisplay;
