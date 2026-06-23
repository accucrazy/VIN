'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MessageSquare, Trash2, X, Loader2 } from 'lucide-react';
import type { ConversationListItem } from '../../hooks/types';

interface ConversationListProps {
  conversations: ConversationListItem[];
  currentId: string | null;
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => Promise<void>;
  onLoadMore?: () => Promise<void>;
}

/**
 * Format relative time for conversation items
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  if (hours < 24) return `${hours} 小時前`;
  if (days < 7) return `${days} 天前`;
  
  return date.toLocaleDateString('zh-TW');
}

/**
 * Conversation List Component
 * 
 * Displays list of conversations in the sidebar.
 * Styled like Gemini's conversation list.
 */
export function ConversationList({
  conversations,
  currentId,
  isLoading,
  isLoadingMore = false,
  hasMore = false,
  onSelect,
  onDelete,
  onLoadMore,
}: ConversationListProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll event handler for infinite scroll
  const handleScroll = useCallback(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const scrollBottom = scrollHeight - scrollTop - clientHeight;
    
    // Trigger load more when within 100px of bottom
    if (scrollBottom < 100) {
      console.log('[ConversationList] Triggering load more');
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLoadingMore]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !onLoadMore) return;
    
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, onLoadMore]);

  const handleDeleteClick = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    setDeleteConfirm(convId);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm || !onDelete) return;
    
    setIsDeleting(true);
    try {
      await onDelete(deleteConfirm);
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirm(null);
  };

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
      <div className="px-3 py-2">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2">
          對話
        </h3>
      </div>
      
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="animate-spin h-5 w-5 text-gray-400" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm px-4">
          尚無對話記錄
        </div>
      ) : (
        <div className="space-y-0.5 px-2">
          {conversations.map((conv) => (
            <div key={conv.id} className="relative group">
              <button
                onClick={() => onSelect(conv.id)}
                className={`
                  w-full text-left px-3 py-2.5 rounded-lg
                  transition-colors duration-150
                  flex items-start gap-2.5
                  ${currentId === conv.id
                    ? 'bg-primary-100 text-primary-700'
                    : 'hover:bg-gray-200 text-gray-700'
                  }
                `}
              >
                <MessageSquare 
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    currentId === conv.id ? 'text-primary-600' : 'text-gray-400'
                  }`} 
                />
                <div className="flex-1 min-w-0 pr-6">
                  <div className="text-sm font-medium truncate">
                    {conv.title || '新對話'}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatRelativeTime(conv.updatedAt)}
                  </div>
                </div>
              </button>
              
              {onDelete && (
                <button
                  onClick={(e) => handleDeleteClick(e, conv.id)}
                  className={`
                    absolute right-2 top-1/2 -translate-y-1/2
                    p-1.5 rounded-md
                    opacity-0 group-hover:opacity-100
                    transition-opacity duration-150
                    hover:bg-red-100 text-gray-400 hover:text-red-600
                  `}
                  title="刪除對話"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          
          {/* Infinite scroll indicator */}
          {hasMore && (
            <div className="flex items-center justify-center py-4">
              {isLoadingMore ? (
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              ) : (
                <span className="text-xs text-gray-400">滾動載入更多</span>
              )}
            </div>
          )}
          
          {/* End of list indicator */}
          {!hasMore && conversations.length > 0 && (
            <div className="flex items-center justify-center py-4">
              <span className="text-xs text-gray-300">已載入全部對話</span>
            </div>
          )}
        </div>
      )}
      
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-5 mx-4 max-w-sm w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">刪除對話</h3>
              <button 
                onClick={handleCancelDelete}
                className="p-1 rounded-md hover:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <p className="text-gray-600 mb-6">
              確定要刪除這個對話嗎？此操作無法復原。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    刪除中...
                  </>
                ) : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConversationList;
