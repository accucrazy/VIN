/**
 * HtmlVisualizationRenderer Component
 * 
 * HTML 視覺化渲染器（簡報、自訂圖表）
 * 支援自動縮放以完整呈現內容，無需滾動。
 */

'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { BarChart3, Maximize2, Minimize2 } from 'lucide-react';
import type { HtmlVisualization } from './types';

export interface HtmlVisualizationRendererProps {
  visualization: HtmlVisualization;
}

/** 容器最大高度（縮放後） */
const MAX_DISPLAY_HEIGHT = 600;
/** 容器最大寬度（縮放後） */
const MAX_DISPLAY_WIDTH = 850;
/** 最小縮放比例（避免過度縮小） */
const MIN_SCALE = 0.3;

export const HtmlVisualizationRenderer = ({ visualization }: HtmlVisualizationRendererProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // 原始內容尺寸（iframe 回報）
  const [contentSize, setContentSize] = useState({ width: 800, height: 400 });
  // 計算出的縮放比例
  const [scale, setScale] = useState(1);
  // 是否展開（100% 大小）
  const [isExpanded, setIsExpanded] = useState(false);

  // 注入自動回報尺寸的腳本
  const responsiveHtml = visualization.html.replace(
    '</head>',
    `<style>
      html { 
        margin: 0 !important; 
        padding: 0 !important;
      }
      body { 
        margin: 0 !important; 
        padding: 0 !important;
      }
    </style>
    <script>
      function reportSize() {
        var w = document.documentElement.scrollWidth || document.body.scrollWidth || 800;
        var h = document.documentElement.scrollHeight || document.body.scrollHeight || 400;
        if (w > 0 && h > 0) {
          window.parent.postMessage({ type: 'iframe-size', width: w, height: h }, '*');
        }
      }
      window.addEventListener('load', function() {
        reportSize();
        setTimeout(reportSize, 300);
        setTimeout(reportSize, 800);
        setTimeout(reportSize, 1500);
      });
      if (window.ResizeObserver && document.body) {
        new ResizeObserver(reportSize).observe(document.body);
      }
    </script>
    </head>`
  );

  // 監聽 iframe 回傳的尺寸
  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === 'iframe-size' && 
        typeof event.data.width === 'number' && 
        typeof event.data.height === 'number') {
      const { width, height } = event.data;
      if (width > 0 && height > 0) {
        setContentSize({ width, height });
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // 計算縮放比例以適應容器
  useEffect(() => {
    if (isExpanded) {
      setScale(1);
      return;
    }

    const containerWidth = containerRef.current?.clientWidth || MAX_DISPLAY_WIDTH;
    const maxWidth = Math.min(containerWidth, MAX_DISPLAY_WIDTH);
    const maxHeight = MAX_DISPLAY_HEIGHT;

    const scaleX = maxWidth / contentSize.width;
    const scaleY = maxHeight / contentSize.height;
    const newScale = Math.max(MIN_SCALE, Math.min(1, scaleX, scaleY));
    
    setScale(newScale);
  }, [contentSize, isExpanded]);

  // 縮放後的顯示尺寸
  const displayWidth = contentSize.width * scale;
  const displayHeight = contentSize.height * scale;

  // 是否需要縮放（內容超過容器）
  const needsScaling = scale < 0.95;

  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-lg">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-indigo-600" />
          {visualization.title}
        </h3>
        <div className="flex items-center gap-2">
          {needsScaling && (
            <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded-full">
              {Math.round(scale * 100)}%
            </span>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg hover:bg-white/80 transition-colors"
            title={isExpanded ? '縮小' : '展開原始大小'}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4 text-gray-600" />
            ) : (
              <Maximize2 className="w-4 h-4 text-gray-600" />
            )}
          </button>
        </div>
      </div>

      {/* Content Container */}
      <div 
        ref={containerRef}
        className={`w-full bg-white transition-all duration-300 ease-out ${isExpanded ? 'overflow-auto' : 'overflow-hidden'}`}
        style={{ 
          height: isExpanded ? `${Math.min(contentSize.height + 20, MAX_DISPLAY_HEIGHT)}px` : `${displayHeight}px`,
          maxHeight: isExpanded ? '80vh' : undefined,
        }}
      >
        <div
          style={{
            width: `${contentSize.width}px`,
            height: `${contentSize.height}px`,
            transform: isExpanded ? 'none' : `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={responsiveHtml}
            className="border-0"
            style={{ 
              width: `${contentSize.width}px`, 
              height: `${contentSize.height}px`,
            }}
            sandbox="allow-scripts"
            title={visualization.title}
          />
        </div>
      </div>
    </div>
  );
};

export default HtmlVisualizationRenderer;
