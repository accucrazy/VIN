'use client';

import React from 'react';

interface CollapsibleSidebarProps {
  isCollapsed: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}

/**
 * Collapsible Sidebar Wrapper
 * 
 * Desktop: Fixed width of 260px, collapses to 0px with smooth animation.
 * Mobile: Overlay mode with backdrop.
 */
export function CollapsibleSidebar({ isCollapsed, onClose, children }: CollapsibleSidebarProps) {
  return (
    <>
      {/* Mobile backdrop overlay */}
      {!isCollapsed && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          flex-shrink-0 h-full
          transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          overflow-hidden
          border-r border-gray-200
          bg-gray-50/80 backdrop-blur-sm
          flex flex-col
          ${isCollapsed ? 'w-0' : 'w-[260px]'}
          
          max-md:fixed max-md:top-[54px] max-md:left-0 max-md:bottom-0 max-md:z-50
          ${isCollapsed ? 'max-md:-translate-x-full' : 'max-md:translate-x-0'}
        `}
      >
        <div className="w-[260px] h-full flex flex-col">
          {children}
        </div>
      </aside>
    </>
  );
}

export default CollapsibleSidebar;
