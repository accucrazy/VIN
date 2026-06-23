'use client';

import React from 'react';

interface ChatLayoutProps {
  sidebar: React.ReactNode;
  header: React.ReactNode;
  messages: React.ReactNode;
  input: React.ReactNode;
}

/**
 * Chat Layout Component
 * 
 * Main layout container with sidebar and main content area.
 * Uses flexbox for responsive layout.
 */
export function ChatLayout({
  sidebar,
  header,
  messages,
  input,
}: ChatLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="h-screen flex pt-[54px]">
        {/* Sidebar */}
        {sidebar}

        {/* Main content area */}
        <main className="flex-1 flex flex-col min-w-0 h-full relative">
          {header}
          {messages}
          {/* Floating input at bottom */}
          <div className="absolute bottom-0 left-0 right-0">
            {input}
          </div>
        </main>
      </div>
    </div>
  );
}

export default ChatLayout;
