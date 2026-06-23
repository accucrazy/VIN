'use client';

import React, { useState, useCallback } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { MessageBubble } from '../MessageBubble';
import { getAgentDisplay } from '../agentDisplay';
import type { Message } from '../../hooks/types';

function CollapsedBubble({
  message,
  onExpand,
}: {
  message: Message;
  onExpand: () => void;
}) {
  const d = getAgentDisplay(message.agentId || '', message.agentName);

  const hasContent = !!(message.content || (message.toolCalls && message.toolCalls.length > 0));
  const isComplete = hasContent && message.content;

  return (
    <button
      onClick={onExpand}
      className={`
        flex flex-col items-center gap-2 px-3 py-4 rounded-2xl border
        ${d.bgColor} ${d.borderColor}
        hover:shadow-md transition-all duration-300 cursor-pointer
        flex-shrink-0 w-[72px] min-h-[120px]
      `}
      title={`Expand ${d.name}`}
    >
      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white shadow-sm">
        {d.avatar ? (
          <Image src={d.avatar} alt={d.name} width={32} height={32} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex items-center justify-center text-white text-xs font-semibold ${d.solidBgColor}`}>{d.initial}</div>
        )}
      </div>
      <span className={`text-[10px] font-semibold ${d.color} text-center leading-tight`}>
        {d.name}
      </span>
      {isComplete ? (
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      ) : (
        <div className="w-3 h-3 rounded-full bg-blue-400 animate-pulse" />
      )}
      <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
    </button>
  );
}

interface ParallelAgentGroupProps {
  messages: Message[];
}

export function ParallelAgentGroup({ messages }: ParallelAgentGroupProps) {
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((msgId: string) => {
    setCollapsedSet(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }, []);

  const expandMessage = useCallback((msgId: string) => {
    setCollapsedSet(prev => {
      const next = new Set(prev);
      next.delete(msgId);
      return next;
    });
  }, []);

  if (messages.length <= 1) {
    return <MessageBubble message={messages[0]} />;
  }

  return (
    <>
      {/* Desktop: side-by-side */}
      <div className="hidden md:flex gap-3 mb-4 items-stretch">
        {messages.map((msg) => {
          const isCollapsed = collapsedSet.has(msg.id);

          if (isCollapsed) {
            return (
              <CollapsedBubble
                key={msg.id}
                message={msg}
                onExpand={() => expandMessage(msg.id)}
              />
            );
          }

          return (
            <div
              key={msg.id}
              className="flex-1 min-w-0 relative transition-all duration-300 ease-in-out"
            >
              {/* Collapse button */}
              <button
                onClick={() => toggleCollapse(msg.id)}
                className={`
                  absolute -top-1 -right-1 z-10 p-1 rounded-full
                  bg-white border border-gray-200 shadow-sm
                  hover:bg-gray-50 transition-colors
                `}
                title={`Collapse ${msg.agentName || 'Agent'}`}
              >
                <ChevronLeft className="w-3.5 h-3.5 text-gray-500" />
              </button>
              <MessageBubble message={msg} fullWidth />
            </div>
          );
        })}
      </div>

      {/* Mobile: stacked vertically (default behavior) */}
      <div className="md:hidden">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>
    </>
  );
}

export default ParallelAgentGroup;
