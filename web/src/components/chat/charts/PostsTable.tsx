/**
 * PostsTable Component
 * 
 * 文章列表表格（支援分頁、收折、排序）
 */

'use client';

import React, { useState, useMemo } from 'react';
import { FileText, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { getSourceStyle } from './colors';
import type { PostData } from './types';

// 排序欄位類型
type SortColumn = 'date' | 'source' | 'title' | 'likes' | 'comments' | 'volume' | 'sentiment' | null;
type SortDirection = 'asc' | 'desc';

export interface PostsTableProps {
  data: PostData[];
  title?: string;
  showVolume?: boolean;
  pageSize?: number;
  /** 預設是否收折（default: true） */
  defaultCollapsed?: boolean;
}

// ============================================================================
// Sentiment 顏色配置（與 DataLake PostsSearchTable 一致）
// ============================================================================

function getSentimentInfo(sentiment: number | null | undefined): {
  color: string;
  label: string;
  textColor: string;
} {
  if (sentiment == null) {
    return { color: '#e5e7eb', label: 'N/A', textColor: 'text-gray-400' };
  }
  if (sentiment > 0.6) {
    return { color: '#41ee81', label: 'Very Positive', textColor: 'text-gray-800' };
  } else if (sentiment > 0.1) {
    return { color: '#78b6ee', label: 'Positive', textColor: 'text-gray-800' };
  } else if (sentiment > -0.1) {
    return { color: '#ffff77', label: 'Neutral', textColor: 'text-gray-700' };
  } else if (sentiment > -0.6) {
    return { color: '#FF9A3C', label: 'Negative', textColor: 'text-gray-800' };
  } else {
    return { color: '#ff4863', label: 'Very Negative', textColor: 'text-white' };
  }
}

const formatDate = (dateString: string) => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateString;
  }
};

export const PostsTable = ({ 
  data, 
  title,
  showVolume = true,
  pageSize = 15,
  defaultCollapsed = true,
}: PostsTableProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // 處理排序點擊
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // 同一欄位：切換方向
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // 不同欄位：設為該欄位，預設降序
      setSortColumn(column);
      setSortDirection('desc');
    }
    setCurrentPage(1); // 排序後回到第一頁
  };

  // 排序後的數據
  const sortedData = useMemo(() => {
    if (!sortColumn) return data;
    
    return [...data].sort((a, b) => {
      let aVal: number | string | null = null;
      let bVal: number | string | null = null;
      
      switch (sortColumn) {
        case 'date':
          aVal = a.pageCreatedAt || '';
          bVal = b.pageCreatedAt || '';
          break;
        case 'source':
          aVal = a.source || '';
          bVal = b.source || '';
          break;
        case 'title':
          aVal = a.title || '';
          bVal = b.title || '';
          break;
        case 'likes':
          aVal = a.likes || 0;
          bVal = b.likes || 0;
          break;
        case 'comments':
          aVal = a.comments || 0;
          bVal = b.comments || 0;
          break;
        case 'volume':
          aVal = a.volume || 0;
          bVal = b.volume || 0;
          break;
        case 'sentiment':
          aVal = a.sentiment ?? -999;
          bVal = b.sentiment ?? -999;
          break;
      }
      
      // 比較
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const cmp = aVal.localeCompare(bVal, 'zh-TW');
        return sortDirection === 'asc' ? cmp : -cmp;
      }
      
      const cmp = (aVal as number) - (bVal as number);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [data, sortColumn, sortDirection]);
  
  if (!data || data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <p className="text-gray-500 text-sm">No posts found</p>
      </div>
    );
  }

  const totalPages = Math.ceil(sortedData.length / pageSize);
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const displayData = sortedData.slice(startIdx, endIdx);
  const totalVolume = data.reduce((sum, p) => sum + (p.volume || 0), 0);
  const showSentiment = data.some(p => p.sentiment != null && p.sentiment !== 0);
  
  // 排序指示器組件
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-indigo-600 ml-1" />
      : <ArrowDown className="w-3 h-3 text-indigo-600 ml-1" />;
  };
  
  // 可排序表頭組件
  const SortableHeader = ({ 
    column, 
    children, 
    className = '',
    align = 'left'
  }: { 
    column: SortColumn; 
    children: React.ReactNode; 
    className?: string;
    align?: 'left' | 'center';
  }) => (
    <th
      onClick={() => handleSort(column)}
      className={`px-3 py-2 text-${align} text-xs font-medium text-gray-500 cursor-pointer hover:bg-gray-100 select-none transition-colors ${className}`}
    >
      <span className={`inline-flex items-center ${align === 'center' ? 'justify-center w-full' : ''}`}>
        {children}
        <SortIndicator column={column} />
      </span>
    </th>
  );

  // 分頁按鈕邏輯
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    return pages;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-4">
      {/* Header - Clickable to toggle collapse */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
          <FileText className="w-4 h-4 text-indigo-600" />
          {title || '搜尋結果'}
        </h3>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>共 <strong className="text-gray-700">{data.length}</strong> 篇</span>
          {showVolume && (
            <span>總聲量 <strong className="text-indigo-600">{totalVolume.toLocaleString()}</strong></span>
          )}
          {/* 展開/收折按鈕 */}
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            isCollapsed 
              ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' 
              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
          }`}>
            {isCollapsed ? (
              <>
                <ChevronDown className="w-3 h-3" />
                展開列表
              </>
            ) : (
              <>
                <ChevronRight className="w-3 h-3" />
                收折
              </>
            )}
          </span>
        </div>
      </button>
      
      {/* Collapsible Content */}
      {!isCollapsed && (
      <>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-[50px]">#</th>
              <SortableHeader column="date" className="w-[70px]">日期</SortableHeader>
              <SortableHeader column="source" className="w-[80px]">來源</SortableHeader>
              <SortableHeader column="title">標題</SortableHeader>
              <SortableHeader column="likes" className="w-[60px]" align="center">👍</SortableHeader>
              <SortableHeader column="comments" className="w-[60px]" align="center">💬</SortableHeader>
              {showVolume && (
                <SortableHeader column="volume" className="w-[70px]" align="center">聲量</SortableHeader>
              )}
              {showSentiment && (
                <SortableHeader column="sentiment" className="w-[80px]" align="center">情緒</SortableHeader>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {displayData.map((post, idx) => (
              <tr key={post.postId || idx} className="hover:bg-gray-50 transition-colors">
                {/* 序號 */}
                <td className="px-3 py-2 text-xs text-gray-400">
                  {startIdx + idx + 1}
                </td>
                
                {/* 日期 */}
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {formatDate(post.pageCreatedAt || '')}
                </td>
                
                {/* 來源 */}
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getSourceStyle(post.source || '')}`}>
                    {post.source || '-'}
                  </span>
                </td>
                
                {/* 標題 */}
                <td className="px-3 py-2 max-w-[300px]">
                  {post.url ? (
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 hover:underline line-clamp-1"
                      title={post.title || ''}
                    >
                      {post.title || 'View Post'}
                    </a>
                  ) : (
                    <span className="text-gray-700 line-clamp-1" title={post.title || ''}>
                      {post.title || '-'}
                    </span>
                  )}
                </td>
                
                {/* 按讚 */}
                <td className="px-3 py-2 text-center text-xs text-gray-600">
                  {(post.likes || 0).toLocaleString()}
                </td>
                
                {/* 留言 */}
                <td className="px-3 py-2 text-center text-xs text-gray-600">
                  {(post.comments || 0).toLocaleString()}
                </td>
                
                {/* 聲量 */}
                {showVolume && (
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">
                      {(post.volume || 0).toLocaleString()}
                    </span>
                  </td>
                )}
                
                {/* 情緒 */}
                {showSentiment && (() => {
                  const sentimentInfo = getSentimentInfo(post.sentiment);
                  return (
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sentimentInfo.textColor}`}
                        style={{ backgroundColor: sentimentInfo.color }}
                        title={post.sentiment != null ? `Score: ${post.sentiment.toFixed(2)}` : 'Not analyzed'}
                      >
                        {post.sentiment != null ? post.sentiment.toFixed(2) : '-'}
                      </span>
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            顯示第 {startIdx + 1} - {Math.min(endIdx, data.length)} 筆，共 {data.length} 筆
          </div>
          
          <div className="flex items-center gap-1">
            {/* 上一頁 */}
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ←
            </button>
            
            {/* 頁碼按鈕 */}
            {getPageNumbers().map((page, idx) => (
              typeof page === 'number' ? (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(page)}
                  className={`px-2.5 py-1 text-xs rounded border ${
                    currentPage === page
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={idx} className="px-1 text-gray-400">...</span>
              )
            ))}
            
            {/* 下一頁 */}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              →
            </button>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default PostsTable;
