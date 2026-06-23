'use client';

import React from 'react';
import { Menu, Cpu, ChevronDown } from 'lucide-react';
import { AgentToolIndicator } from '../AgentToolIndicator';
import type { ToolCall } from '@/components/chat';

interface ChatHeaderProps {
  isSidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  isLoading: boolean;
  currentToolCalls: ToolCall[];
  activeAgents: string[];
  completedAgents: string[];
  enabledAgents: string[];
  /** 目前選用的 Ollama model 名（e.g. "qwen3.5:9b"） */
  model?: string;
  /** 可選的 Ollama models 列表（由 page.tsx 從 /api/tags 拉取後傳入） */
  availableModels?: string[];
  /** 模型切換 callback */
  onModelChange?: (model: string) => void;
}

export function ChatHeader({
  isSidebarCollapsed,
  onExpandSidebar,
  isLoading,
  currentToolCalls,
  activeAgents,
  completedAgents,
  enabledAgents,
  model,
  availableModels,
  onModelChange,
}: ChatHeaderProps) {
  return (
    <div className="flex-shrink-0 px-4 py-3 border-b bg-white/80 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {/* Expand sidebar button (only when collapsed) */}
        {isSidebarCollapsed && (
          <button
            onClick={onExpandSidebar}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="展開側邊欄"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1
            className="text-lg font-extrabold text-gray-800 flex items-center gap-1.5 tracking-wide"
            style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
          >
            THE POCKET COMPANY
            <span className="text-xs font-medium bg-gradient-to-r from-brand-600 to-emerald-600 bg-clip-text text-transparent">
              (Open Source)
            </span>
          </h1>
          <p className="text-xs text-gray-500">VIN AIOS · On-prem AI agent</p>
        </div>

        {/* Model selector */}
        {onModelChange && (
          <ModelSelector
            model={model ?? ''}
            availableModels={availableModels ?? []}
            onChange={onModelChange}
          />
        )}
      </div>

      {/* Agent & Tool indicators */}
      <div className="mt-2 text-xs">
        <AgentToolIndicator
          isLoading={isLoading}
          currentToolCalls={currentToolCalls}
          activeAgents={activeAgents}
          completedAgents={completedAgents}
          enabledAgents={enabledAgents}
        />
      </div>
    </div>
  );
}

interface ModelSelectorProps {
  model: string;
  availableModels: string[];
  onChange: (model: string) => void;
}

function ModelSelector({ model, availableModels, onChange }: ModelSelectorProps) {
  const isEmpty = availableModels.length === 0;
  return (
    <label
      className="relative flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs text-gray-700 cursor-pointer transition-colors"
      title="切換 Ollama 模型"
    >
      <Cpu className="w-3.5 h-3.5 text-brand-600" />
      <span className="font-mono max-w-[160px] truncate">
        {model || (isEmpty ? 'no models' : 'select model')}
      </span>
      <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      <select
        value={model}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
        disabled={isEmpty}
      >
        {!model && <option value="">— select model —</option>}
        {availableModels.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </label>
  );
}

export default ChatHeader;
