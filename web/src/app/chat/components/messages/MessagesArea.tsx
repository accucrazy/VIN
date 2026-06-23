'use client';

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import Image from 'next/image';
import { ArrowDown, Search } from 'lucide-react';
import { MessageBubble } from '../MessageBubble';
import { ParallelAgentGroup } from './ParallelAgentGroup';
// ToolExecution 沒從 the-pocket-pandora 搬過來；用簡單的「正在執行 N tools」提示。
import type { ToolCall as _ToolCall } from '@/components/chat';
function InflightToolsPill({ toolCalls }: { toolCalls: _ToolCall[] }) {
  if (toolCalls.length === 0) return null;
  const active = toolCalls[toolCalls.length - 1];
  const isSearch = active?.tool === 'web_search';
  const query = active?.input?.query ?? active?.input?.url;
  const label = isSearch ? '搜尋網路' : (active?.tool ?? 'tool');
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-medium">
      <Search className="w-3.5 h-3.5 animate-pulse" />
      <span>{label}{query ? `：${String(query)}` : ''}…</span>
    </div>
  );
}
import { getAgentDisplay } from '../agentDisplay';
import type { Message, ToolCall } from '../../hooks/types';

/**
 * Loading 狀態的 Agent 頭像顯示
 * 讓用戶知道當前是哪個 Agent 在工作
 */
function LoadingAgentAvatar({ agentId, agentName }: { agentId?: string; agentName?: string }) {
  if (!agentId) return null;

  const d = getAgentDisplay(agentId, agentName);
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0">
        {d.avatar ? (
          <Image src={d.avatar} alt={d.name} width={24} height={24} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex items-center justify-center text-white text-xs font-semibold ${d.solidBgColor}`}>{d.initial}</div>
        )}
      </div>
      <span className={`text-sm font-medium ${d.color}`}>{d.name}</span>
    </div>
  );
}

interface MessagesAreaProps {
  messages: Message[];
  isLoading: boolean;
  isDeepThinking?: boolean;
  isReviewing?: boolean;
  isReconnecting?: boolean;
  reconnectProgress?: {
    currentTool?: string;
    completedTools?: string[];
    agentName?: string;
  } | null;
  currentToolCalls: ToolCall[];
  currentAgentId?: string;
  currentAgentName?: string;
  exampleQuestions: string[];
  onExampleClick: (question: string) => void;
}

/**
 * Messages Area Component
 * 
 * Displays chat messages with auto-scroll and empty state.
 */
export function MessagesArea({
  messages,
  isLoading,
  isDeepThinking,
  isReviewing,
  isReconnecting,
  reconnectProgress,
  currentToolCalls,
  currentAgentId,
  currentAgentName,
  exampleQuestions,
  onExampleClick,
}: MessagesAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const [hasNewContentBelow, setHasNewContentBelow] = useState(false);

  const SCROLL_THRESHOLD = 150;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < SCROLL_THRESHOLD) {
      setUserHasScrolledUp(false);
      setHasNewContentBelow(false);
    } else {
      setUserHasScrolledUp(true);
    }
  }, []);

  const jumpToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUserHasScrolledUp(false);
    setHasNewContentBelow(false);
  }, []);

  useEffect(() => {
    if (!userHasScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setHasNewContentBelow(true);
    }
  }, [messages, currentToolCalls, userHasScrolledUp]);

  // All hooks must be called before any conditional returns
  const groupedMessages = useMemo(() => {
    // 按時間戳排序確保訊息順序正確（用戶訊息應始終在對應的 AI 回應之前）
    const sortedMessages = [...messages].sort((a, b) => {
      const timeA = a.timestamp.getTime();
      const timeB = b.timestamp.getTime();
      if (timeA !== timeB) return timeA - timeB;
      // 如果時間相同，確保 user 訊息在 assistant 之前
      if (a.role === 'user' && b.role === 'assistant') return -1;
      if (a.role === 'assistant' && b.role === 'user') return 1;
      return 0;
    });
    
    const groups: Array<Message | Message[]> = [];
    let currentGroup: Message[] = [];

    for (const msg of sortedMessages) {
      if (msg.parallelGroupId) {
        if (currentGroup.length > 0 && currentGroup[0].parallelGroupId === msg.parallelGroupId) {
          currentGroup.push(msg);
        } else {
          if (currentGroup.length > 0) groups.push(currentGroup);
          currentGroup = [msg];
        }
      } else {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        groups.push(msg);
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }, [messages]);

  // Empty state
  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        <div className="h-full flex flex-col items-center justify-center text-center">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            歡迎使用 THE POCKET COMPANY
          </h2>
          <p className="text-gray-500 mb-6 max-w-md">
            我可以幫助您分析社群媒體數據、查詢聲量趨勢、生成圖表報告。
            試著問我一些問題吧！
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
            {exampleQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => onExampleClick(q)}
                className="text-left px-4 py-3 bg-white rounded-xl border border-gray-200 
                           hover:border-primary-300 hover:bg-primary-50 transition-all text-sm text-gray-700"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 pb-32"
      >
        {groupedMessages.map((item) =>
          Array.isArray(item) ? (
            <ParallelAgentGroup key={item[0].parallelGroupId || item[0].id} messages={item} />
          ) : (
            <MessageBubble key={item.id} message={item} />
          )
        )}

        {/* Reconnection indicator */}
        {isReconnecting && !isLoading && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[90%] rounded-2xl shadow-sm px-4 py-3 bg-blue-50 text-blue-700 border border-blue-200">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium">
                  {reconnectProgress?.agentName
                    ? `${reconnectProgress.agentName} is still working...`
                    : 'Task running in background...'}
                </span>
              </div>
              {reconnectProgress?.currentTool && (
                <div className="text-xs text-blue-500 mt-1 ml-4">
                  Running: {reconnectProgress.currentTool}
                </div>
              )}
              {reconnectProgress?.completedTools && reconnectProgress.completedTools.length > 0 && (
                <div className="text-xs text-blue-400 mt-0.5 ml-4">
                  Completed: {reconnectProgress.completedTools.join(', ')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tool execution progress — only while the streaming assistant bubble
            is still empty. Once tokens arrive, the bubble itself shows progress,
            so this bottom indicator would just be a redundant empty agent bubble. */}
        {isLoading &&
          (() => {
            const last = messages[messages.length - 1];
            const streamingHasContent =
              last?.role === 'assistant' && !!last.content && last.content.length > 0;
            return !streamingHasContent;
          })() && (
          <div className="flex justify-start mb-4">
            <div className="flex flex-col items-start gap-1">
              {/* Deep thinking indicator */}
              {isDeepThinking && (
                <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  🧠 深度思考中
                </span>
              )}
              <div
                className={`max-w-[90%] rounded-2xl shadow-sm bg-white text-gray-800 border border-gray-200 ${
                  currentToolCalls.length === 0 && !isReviewing
                    ? 'px-4 py-2 min-w-[48px]' 
                    : 'px-5 py-4 min-w-[360px] sm:min-w-[520px]'
                }`}
              >
                {/* 顯示當前工作的 Agent 頭像和名字（review 階段強制顯示 Stacey） */}
                <LoadingAgentAvatar 
                  agentId={isReviewing ? 'host' : currentAgentId} 
                  agentName={isReviewing && !currentAgentName ? 'Stacey' : currentAgentName} 
                />
                
                {/* Reviewing 標示：Host Agent 正在確認子 Agent 的工作 */}
                {isReviewing && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium mb-2">
                    <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                    <span>Reviewing</span>
                  </div>
                )}
                
                <InflightToolsPill toolCalls={currentToolCalls} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Jump to Bottom badge — aligned with input box right edge */}
      {hasNewContentBelow && (
        <div className="absolute bottom-[100px] left-0 right-0 px-4 md:px-6 z-30 pointer-events-none">
          <div className="max-w-3xl mx-auto relative">
            <button
              onClick={jumpToBottom}
              className="absolute right-0 bottom-0 pointer-events-auto
                         inline-flex items-center gap-1.5 px-3 py-1.5
                         rounded-full bg-primary-600 text-white text-xs
                         shadow-lg hover:bg-primary-700 transition-colors
                         animate-fade-in-up"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>New content below</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default MessagesArea;
