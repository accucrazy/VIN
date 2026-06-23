/**
 * DataTable Component
 * 
 * 顯示查詢結果的數據表格
 */

'use client';

import React from 'react';

export interface DataContent {
  fields: string[];
  rows: Record<string, any>[];
}

export function DataTable({ data }: { data: DataContent | null }) {
  if (!data || !data.rows || !data.fields || data.rows.length === 0) {
    return (
      <div className="text-gray-500 text-sm italic py-2">
        No data returned
      </div>
    );
  }

  return (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {data.fields.map((field) => (
              <th
                key={field}
                className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.rows.slice(0, 100).map((row, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              {data.fields.map((field) => (
                <td key={field} className="px-4 py-2 whitespace-nowrap text-gray-700">
                  {typeof row[field] === 'object'
                    ? JSON.stringify(row[field])
                    : String(row[field] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length > 100 && (
        <div className="text-xs text-gray-500 mt-2 text-center">
          Showing 100 of {data.rows.length} rows
        </div>
      )}
    </div>
  );
}

export default DataTable;
