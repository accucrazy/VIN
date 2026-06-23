/**
 * AgentToolIndicator Component
 * 
 * 顯示 Agent 工具執行狀態的燈號指示器
 * - Agent 燈號：Stacey / Pandora / Moana（各自獨立狀態）
 * - 工具燈號：Search / DataLake / Chart 等（動態顯示）
 */

'use client';

import React from 'react';
import Image from 'next/image';
import type { ToolCall } from '@/components/chat';

// ============================================================
// 工具燈號配置
// ============================================================

/** 工具到燈號的映射（用於判斷階段和完成狀態） */
export const TOOL_MAPPING: Record<string, string[]> = {
  search: ['research_brand', 'expand_keywords', 'web_search'],
  datalake: ['analyze_brand', 'search_posts', 'get_trend', 'smart_query'],
  memory: ['memory_search', 'memory_recall', 'memory_store', 'memory_forget'],
  chart: ['design_chart', 'render_html', 'canvas'],
  // 擴展燈號（動態顯示）
  document: ['extract_pdf', 'extract_docx', 'extract_xlsx', 'extract_pptx'],
  workspace: ['create_presentation', 'create_spreadsheet', 'create_document', 'export_workspace_file', 'upload_image'],
  web: ['web_fetch', 'browser'],
  banana: ['describe_image', 'generate_image'],
  news: ['news_track_coverage', 'news_analyze_repost', 'news_stats'],
  maps: ['maps_search', 'maps_explore'],
  // Moana 專用工具
  moana: ['generate_brief', 'generate_posts'],
};

/**
 * Agent 燈號配置 — 對齊 VIN src/agent/registry.ts。
 * `avatar` 設為 null 走首字母色塊，不需要 public 圖片資產。
 */
const AGENT_INDICATORS = [
  {
    key: 'vin',
    label: 'Vin',
    color: 'purple',
    avatar: null as string | null,
  },
  {
    key: 'researcher',
    label: 'Researcher',
    color: 'emerald',
    avatar: null as string | null,
  },
] as const;

/** 工具燈號（永遠顯示） */
const CORE_TOOL_INDICATORS = [
  { key: 'search', label: 'Search' },
  { key: 'datalake', label: 'DataLake' },
  { key: 'chart', label: 'Chart' },
] as const;

/** 擴展工具燈號（使用時才顯示） */
const EXTENDED_TOOL_INDICATORS = [
  { key: 'memory', label: 'Memory' },
  { key: 'document', label: 'Document' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'web', label: 'Web' },
  { key: 'banana', label: 'Banana' },
  { key: 'news', label: 'News' },
  { key: 'maps', label: 'Maps' },
  { key: 'moana', label: 'Brief' },
] as const;

/** 根據工具名稱取得對應的燈號 key */
function getToolPhase(toolName: string): string | null {
  for (const [phase, tools] of Object.entries(TOOL_MAPPING)) {
    if (tools.includes(toolName)) {
      return phase;
    }
  }
  return null;
}

// ============================================================
// Component
// ============================================================

export interface AgentToolIndicatorProps {
  isLoading: boolean;
  currentToolCalls: ToolCall[];
  /** 當前活躍的 Agent IDs */
  activeAgents?: string[];
  /** 已完成的 Agent IDs */
  completedAgents?: string[];
  /** 用戶啟用的 Agent IDs（用於過濾顯示） */
  enabledAgents?: string[];
}

export function AgentToolIndicator({ 
  isLoading, 
  currentToolCalls,
  activeAgents = [],
  completedAgents = [],
  enabledAgents = [],
}: AgentToolIndicatorProps) {
  // 判斷目前正在執行的工具階段
  const getCurrentToolPhase = (): string | null => {
    if (!isLoading || currentToolCalls.length === 0) return null;
    
    const lastTool = currentToolCalls[currentToolCalls.length - 1]?.tool;
    if (!lastTool) return null;
    
    return getToolPhase(lastTool);
  };

  // 判斷工具類別是否已完成（有被調用過）
  const isToolCompleted = (toolKey: string): boolean => {
    if (currentToolCalls.length === 0) return false;
    const relatedTools = TOOL_MAPPING[toolKey] || [];
    return currentToolCalls.some(tc => relatedTools.includes(tc.tool));
  };

  // 判斷哪些擴展燈號需要顯示（有被使用過）
  const getVisibleExtendedTools = () => {
    return EXTENDED_TOOL_INDICATORS.filter(tool => isToolCompleted(tool.key));
  };

  // 判斷 Agent 狀態
  const getAgentStatus = (agentKey: string): 'active' | 'completed' | 'idle' => {
    if (!isLoading) return 'idle';
    if (activeAgents.includes(agentKey)) return 'active';
    if (completedAgents.includes(agentKey)) return 'completed';
    // 如果沒有傳入 activeAgents，使用舊邏輯（Stacey 預設活躍）
    if (activeAgents.length === 0 && agentKey === 'host' && currentToolCalls.length === 0) return 'active';
    if (activeAgents.length === 0 && agentKey === 'host' && currentToolCalls.length > 0) return 'completed';
    return 'idle';
  };

  const currentToolPhase = getCurrentToolPhase();
  const visibleExtendedTools = getVisibleExtendedTools();
  
  // 組合要顯示的工具燈號
  const visibleToolIndicators = [
    ...CORE_TOOL_INDICATORS,
    ...visibleExtendedTools,
  ];
  
  // 根據 enabledAgents 過濾要顯示的 Agent 燈號
  // 如果 enabledAgents 為空，不顯示任何 Agent（等待載入）
  const visibleAgentIndicators = enabledAgents.length > 0
    ? AGENT_INDICATORS.filter(agent => enabledAgents.includes(agent.key))
    : [];
  
  // 是否正在載入 Agent 配置
  const isLoadingConfig = enabledAgents.length === 0;

  // 渲染 Agent 燈號
  const renderAgentIndicators = () => {
    if (isLoadingConfig) {
      return (
        <div className="flex items-center gap-1.5 text-gray-400 text-xs">
          <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
          <span>Loading...</span>
        </div>
      );
    }

    return visibleAgentIndicators.map((agent) => {
      const status = getAgentStatus(agent.key);
      const isActive = status === 'active';
      const isCompleted = status === 'completed';
      
      const colorMap = {
        blue: { active: 'bg-blue-500', completed: 'bg-blue-400', text: 'text-blue-600' },
        purple: { active: 'bg-purple-500', completed: 'bg-purple-400', text: 'text-purple-600' },
        pink: { active: 'bg-pink-500', completed: 'bg-pink-400', text: 'text-pink-600' },
        emerald: { active: 'bg-emerald-500', completed: 'bg-emerald-400', text: 'text-emerald-600' },
      };
      const colors = colorMap[agent.color];
      
      return (
        <div key={agent.key} className="flex items-center gap-1.5">
          {agent.avatar ? (
            <div className={`
              w-5 h-5 rounded-full overflow-hidden flex-shrink-0 transition-all duration-200
              ${isActive ? 'ring-2 ring-offset-1 ring-emerald-400 animate-pulse' : ''}
              ${isCompleted ? 'ring-1 ring-emerald-300' : ''}
              ${!isActive && !isCompleted ? 'opacity-40 grayscale' : ''}
            `}>
              <Image 
                src={agent.avatar} 
                alt={agent.label} 
                width={20} 
                height={20} 
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className={`
              w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200
              ${isActive 
                ? `${colors.active} animate-pulse` 
                : isCompleted 
                  ? colors.completed
                  : 'bg-gray-300'
              }
            `}>
              <span className="text-[10px] font-bold text-white">
                {agent.label.charAt(0)}
              </span>
            </div>
          )}
          <span className={`
            text-xs transition-all duration-200
            ${isActive 
              ? `${colors.text} font-medium` 
              : isCompleted
                ? 'text-gray-600'
                : 'text-gray-400'
            }
          `}>
            {agent.label}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Agent 燈號區塊 */}
      <div className="flex items-center gap-3 pr-3 border-r border-gray-200">
        {renderAgentIndicators()}
      </div>

      {/* 工具燈號區塊 */}
      {visibleToolIndicators.map((tool) => {
        const isActive = isLoading && currentToolPhase === tool.key;
        const isCompleted = isLoading && !isActive && isToolCompleted(tool.key);
        const isIdle = !isLoading;
        
        return (
          <div
            key={tool.key}
            className={`
              flex items-center gap-1.5 rounded-full transition-all duration-200
              ${isActive
                ? 'bg-emerald-500 px-2.5 py-1 shadow-sm shadow-emerald-300 ring-2 ring-emerald-200 scale-105'
                : isCompleted
                  ? 'bg-emerald-50 px-2 py-0.5'
                  : 'px-0 py-0'
              }
            `}
          >
            {/* 狀態燈號 */}
            <span 
              className={`
                rounded-full transition-all duration-200
                ${isActive 
                  ? 'w-2 h-2 bg-white animate-pulse' 
                  : isCompleted
                    ? 'w-2 h-2 bg-emerald-500'
                    : isIdle
                      ? 'w-2 h-2 bg-gray-300'
                      : 'w-2 h-2 bg-gray-200'
                }
              `}
            />
            {/* 工具名稱 */}
            <span 
              className={`
                text-xs transition-all duration-200
                ${isActive 
                  ? 'text-white font-semibold' 
                  : isCompleted
                    ? 'text-emerald-700 font-medium'
                    : 'text-gray-400'
                }
              `}
            >
              {tool.label}
            </span>
          </div>
        );
      })}

    </div>
  );
}

export default AgentToolIndicator;
