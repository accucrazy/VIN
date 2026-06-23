'use client';

import React, { useEffect, useRef } from 'react';

/**
 * Agent 資訊介面
 */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  color: string;
}

/**
 * 可用的 Agent 列表 — 對齊 VIN src/agent/registry.ts。
 * 新增 agent 時：(1) 在 VIN registry 註冊 (2) 加一筆到這裡。
 */
export const AVAILABLE_AGENTS: AgentInfo[] = [
  {
    id: 'vin',
    name: 'Vin',
    description: '通用型 AI agent（generalist，可委派）',
    color: 'text-brand-600',
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: '專注研究 sub-agent（web_fetch + memory）',
    color: 'text-emerald-600',
  },
];

interface AgentMentionDropdownProps {
  filter: string;
  highlightedIndex: number;
  onSelect: (agent: AgentInfo) => void;
  onHighlightChange: (index: number) => void;
  position: { top: number; left: number };
}

/**
 * Agent Mention 下拉選單
 * 
 * 當用戶輸入 @ 時顯示，支持過濾和鍵盤導航
 */
export function AgentMentionDropdown({
  filter,
  highlightedIndex,
  onSelect,
  onHighlightChange,
  position,
}: AgentMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredAgents = AVAILABLE_AGENTS.filter(agent =>
    agent.name.toLowerCase().startsWith(filter.toLowerCase())
  );

  useEffect(() => {
    if (highlightedIndex >= filteredAgents.length && filteredAgents.length > 0) {
      onHighlightChange(0);
    }
  }, [filter, highlightedIndex, filteredAgents.length, onHighlightChange]);

  useEffect(() => {
    const highlightedItem = dropdownRef.current?.querySelector('[data-highlighted="true"]');
    highlightedItem?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  if (filteredAgents.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      className="absolute z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[240px] max-h-[200px] overflow-y-auto"
      style={{
        bottom: position.top,
        left: position.left,
      }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">
        選擇 Agent（Tab 或 Enter 確認）
      </div>
      {filteredAgents.map((agent, index) => (
        <button
          key={agent.id}
          type="button"
          data-highlighted={index === highlightedIndex}
          onClick={() => onSelect(agent)}
          onMouseEnter={() => onHighlightChange(index)}
          className={`
            w-full px-3 py-2 text-left flex items-center gap-2
            transition-colors duration-100
            ${index === highlightedIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}
          `}
        >
          <span className={`font-semibold ${agent.color}`}>
            @{agent.name}
          </span>
          <span className="text-xs text-gray-400">
            {agent.description}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * 取得 Agent 的顏色 class
 */
export function getAgentColorClass(agentName: string): string {
  const agent = AVAILABLE_AGENTS.find(
    a => a.name.toLowerCase() === agentName.toLowerCase()
  );
  return agent?.color || 'text-gray-600 bg-gray-50';
}

export default AgentMentionDropdown;
