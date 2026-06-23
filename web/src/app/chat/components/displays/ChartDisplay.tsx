/**
 * ChartDisplay Component
 * 
 * 顯示 Vega-Lite 圖表（動態載入 vega-embed）
 * 修復 linter 錯誤：將 VegaRenderer 提取為獨立組件
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';

// Vega 渲染器組件（修復 hooks-in-callback 問題）
function VegaRenderer({ spec }: { spec: any }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      if (!containerRef.current || !spec) return;

      try {
        const vegaEmbed = await import('vega-embed');
        if (isMounted && containerRef.current) {
          await vegaEmbed.default(containerRef.current, spec, {
            actions: false,
            renderer: 'svg',
          });
        }
      } catch (err) {
        console.error('[VegaRenderer] Failed to render chart:', err);
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [spec]);

  return <div ref={containerRef} />;
}

VegaRenderer.displayName = 'VegaRenderer';

export function ChartDisplay({ spec }: { spec: any }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (spec && Object.keys(spec).length > 0) {
      // 預載入 vega 相關庫
      Promise.all([
        import('vega'),
        import('vega-lite'),
        import('vega-embed'),
      ])
        .then(() => {
          console.log('[ChartDisplay] Vega libraries loaded successfully');
          setIsReady(true);
          setError(null);
        })
        .catch((err) => {
          console.error('[ChartDisplay] Failed to load vega libraries:', err);
          setError(`Failed to load chart library: ${err.message}`);
        });
    }
  }, [spec]);

  if (!spec || Object.keys(spec).length === 0) {
    return null;
  }

  if (error) {
    return (
      <div className="my-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700">
        <div className="font-medium mb-1">Chart Error</div>
        <div>{error}</div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs">View raw spec</summary>
          <pre className="mt-1 text-xs overflow-auto max-h-40 bg-gray-100 p-2 rounded">
            {JSON.stringify(spec, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="my-4 bg-gray-100 rounded-lg p-4 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading chart...</div>
      </div>
    );
  }

  return (
    <div className="my-4 bg-white rounded-lg p-4 shadow-sm border overflow-auto">
      <VegaRenderer spec={spec} />
    </div>
  );
}

ChartDisplay.displayName = 'ChartDisplay';

export default ChartDisplay;
