/**
 * SchemaDisplay Component
 * 
 * 顯示數據庫 Schema 資訊（可收折）
 */

'use client';

import React, { useState } from 'react';

export interface SchemaField {
  name: string;
  type: string;
  description?: string;
}

export interface SchemaContent {
  datasources: Array<{
    table: string;
    fields: SchemaField[];
  }>;
}

export function SchemaDisplay({ schema }: { schema: SchemaContent | null }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Guard against null schema or datasources
  if (!schema || !schema.datasources || schema.datasources.length === 0) {
    return null;
  }

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
        <span className="font-medium">Schema Information</span>
      </button>
      {isExpanded && (
        <div className="mt-2 pl-6 space-y-3">
          {schema.datasources.map((ds, idx) => (
            <div key={idx} className="bg-gray-50 rounded-lg p-3">
              <div className="font-mono text-xs text-gray-600 mb-2">{ds.table}</div>
              <div className="space-y-1">
                {(ds.fields || []).map((field) => (
                  <div key={field.name} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-blue-600">{field.name}</span>
                    <span className="text-gray-400">:</span>
                    <span className="text-gray-500">{field.type}</span>
                    {field.description && (
                      <span className="text-gray-400 italic">- {field.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SchemaDisplay;
