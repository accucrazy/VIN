'use client';

import React from 'react';
import { ChevronLeft, Plus } from 'lucide-react';

interface SidebarHeaderProps {
  onNewChat: () => void;
  onCollapse: () => void;
}

/**
 * Sidebar Header Component
 * 
 * Contains collapse toggle and new chat button.
 * Styled like Gemini's sidebar header.
 */
export function SidebarHeader({ onNewChat, onCollapse }: SidebarHeaderProps) {
  return (
    <div className="flex-shrink-0 px-3 py-3 border-b border-gray-200 h-[97px] flex flex-col justify-between">
      {/* Collapse button */}
      <button
        onClick={onCollapse}
        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors w-fit"
        title="收合側邊欄"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      
      {/* New chat button */}
      <button
        onClick={onNewChat}
        className="w-full flex items-center gap-2 px-4 py-2 
                   text-gray-700 hover:bg-gray-200 
                   rounded-full transition-colors text-sm font-medium"
      >
        <Plus className="w-5 h-5" />
        <span>新對話</span>
      </button>
    </div>
  );
}

export default SidebarHeader;
