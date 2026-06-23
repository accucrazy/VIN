/**
 * MessageBubble Component
 * 
 * 聊天訊息氣泡組件，支援多種內容類型渲染
 */

'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// NOTE: 上游 the-pocket-pandora 的 ToolExecution 沒搬（綁後端 SSE event）。
// 這裡用一個輕量 ToolCallCard 顯示 VIN 在前端實際觸發的 tool 調用（web_search 等）。
import {
  TrendChart,
  MultiLineChart,
  HtmlVisualizationRenderer,
  DynamicChart,
  PostsTable,
} from '@/components/chat';
import type { ToolCall } from '@/components/chat';
import { Search, Globe, Wrench, Loader2, CheckCircle2 } from 'lucide-react';

const TOOL_META: Record<string, { label: string; runningLabel: string; Icon: typeof Search }> = {
  web_search: { label: '網路搜尋', runningLabel: '搜尋網路中', Icon: Search },
  web_fetch: { label: '擷取網頁', runningLabel: '擷取網頁中', Icon: Globe },
};

function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[call.tool] ?? { label: call.tool, runningLabel: `${call.tool} 執行中`, Icon: Wrench };
  const Icon = meta.Icon;
  const running = call.output == null;
  const query =
    (call.input && (call.input.query ?? call.input.url)) ??
    (typeof call.input === 'string' ? call.input : '');
  const outputText = typeof call.output === 'string' ? call.output : '';
  const noResults = !running && /^no results found/i.test(outputText.trim());

  return (
    <div
      className={`my-2 rounded-xl border overflow-hidden transition-all duration-300 ${
        running ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-gray-50 border-gray-200'
      }`}
    >
      {/* 💭 模型推理（決定要調用工具的理由） */}
      {call.thought && (
        <div className="px-4 py-2 border-b border-amber-200/60 bg-amber-50/50">
          <div className="flex items-start gap-2">
            <span className="text-xs text-amber-500 flex-shrink-0 mt-0.5">💭</span>
            <p className="text-xs italic leading-relaxed text-amber-700 whitespace-pre-wrap">{call.thought}</p>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        disabled={running}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] transition-colors disabled:cursor-default"
      >
        {/* 狀態圈：執行中 spinner / 完成打勾 */}
        <span
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            running ? 'bg-indigo-100' : 'bg-green-100'
          }`}
        >
          {running ? (
            <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          )}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className={`w-4 h-4 ${running ? 'text-indigo-600' : 'text-gray-500'}`} />
            <span className={`text-sm font-medium ${running ? 'text-indigo-700' : 'text-gray-700'}`}>
              {running ? meta.runningLabel : meta.label}
            </span>
            {query && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 truncate max-w-[240px]">
                {String(query)}
              </span>
            )}
            {!running && call.provider && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-medium">
                via {call.provider}
              </span>
            )}
            {!running && call.duration != null && call.duration > 0 && (
              <span className="text-xs text-gray-400">{(call.duration / 1000).toFixed(1)}s</span>
            )}
          </div>
          {!running && (
            <p className="text-xs mt-1 text-gray-500">
              {noResults ? '查無即時結果（已用模型既有知識回答）' : `找到 ${outputText.split(/\n\n/).filter(Boolean).length} 筆結果，點擊展開`}
            </p>
          )}
        </div>
      </button>

      {open && !running && outputText && (
        <div className="px-4 pb-3 pt-0 border-t border-gray-200">
          <pre className="mt-2 text-[11px] leading-5 text-gray-600 whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono">
            {outputText}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCallsList({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="space-y-2 mb-2">
      {toolCalls.map((c, i) => (
        <ToolCallCard key={`${c.tool}-${i}`} call={c} />
      ))}
    </div>
  );
}
import { DataTable, SchemaDisplay, SqlDisplay, ChartDisplay } from './displays';
import { BrandArticleTabs } from './BrandArticleTabs';
import type { DataContent, SchemaContent } from './displays';
import { markdownComponents } from './MarkdownComponents';
import { getAgentDisplay } from './agentDisplay';
import type { Message, MessageContent } from '../hooks/types';
import Image from 'next/image';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';

/**
 * Agent 名稱對應顏色（用於深色背景的用戶訊息氣泡）
 */
const USER_BUBBLE_AGENT_COLORS: Record<string, string> = {
  Pandora: 'text-indigo-200',
  pandora: 'text-indigo-200',
  Paul: 'text-emerald-200',
  paul: 'text-emerald-200',
  Moana: 'text-pink-200',
  moana: 'text-pink-200',
  Stacey: 'text-blue-200',
  stacey: 'text-blue-200',
};

/**
 * 渲染用戶訊息中的 @Agent（套用顏色）
 */
function renderUserMessageWithMentions(content: string): React.ReactNode {
  const mentionRegex = /@(Pandora|Paul|Moana|Stacey)\b/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = mentionRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={keyIndex++}>{content.slice(lastIndex, match.index)}</span>
      );
    }
    
    const agentName = match[1];
    const colorClass = USER_BUBBLE_AGENT_COLORS[agentName] || 'text-white';
    parts.push(
      <span key={keyIndex++} className={`font-semibold ${colorClass}`}>
        @{agentName}
      </span>
    );
    
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(<span key={keyIndex++}>{content.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : content;
}

/**
 * 解析 <task_steps> 標籤，支援多個帶 agent 屬性的區塊
 * 返回主要內容和每個 agent 的執行步驟
 */
interface AgentTaskSteps {
  agentId: string;
  agentName: string;
  steps: string;
}

function stripInternalMessageBlocks(content: string): string {
  return content
    .replace(/<a2a_context\b[^>]*>[\s\S]*?<\/a2a_context>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTaskSteps(content: string): { mainContent: string; taskStepsList: AgentTaskSteps[] } {
  const visibleContent = stripInternalMessageBlocks(content);
  const agentNames: Record<string, string> = {
    pandora: 'Pandora',
    moana: 'Moana',
    paul: 'Paul',
    host: 'Stacey',
    agent: 'Agent',
  };
  
  // 匹配所有 <task_steps agent="xxx"> 區塊
  const taskStepsRegex = /<task_steps(?:\s+agent="([^"]*)")?>([\s\S]*?)<\/task_steps>/g;
  const taskStepsList: AgentTaskSteps[] = [];
  let match;
  
  while ((match = taskStepsRegex.exec(visibleContent)) !== null) {
    const agentId = match[1] || 'agent';
    const steps = match[2].trim();
    taskStepsList.push({
      agentId,
      agentName: agentNames[agentId] || agentId,
      steps,
    });
  }
  
  // 移除所有 task_steps 區塊後的主要內容
  const mainContent = visibleContent.replace(/<task_steps(?:\s+agent="[^"]*")?>([\s\S]*?)<\/task_steps>/g, '').trim();
  
  return { mainContent, taskStepsList };
}

/**
 * 可收折的執行步驟組件
 * 支援顯示 Agent 名稱標籤
 */
function TaskStepsChip({ steps, agentName }: { steps: string; agentName?: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // 解析步驟列表
  const stepLines = steps.split('\n').filter(line => line.trim());
  
  // Agent 顏色對應
  const agentColors: Record<string, string> = {
    Pandora: 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100',
    Moana: 'text-pink-600 bg-pink-50 hover:bg-pink-100',
    Paul: 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100',
    Stacey: 'text-blue-600 bg-blue-50 hover:bg-blue-100',
  };
  const colorClass = agentName ? (agentColors[agentName] || 'text-gray-600 bg-gray-100 hover:bg-gray-200') : 'text-gray-600 bg-gray-100 hover:bg-gray-200';
  
  return (
    <div className="mt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors text-xs ${colorClass}`}
      >
        <ListChecks className="w-3.5 h-3.5" />
        {agentName && <span className="font-medium">{agentName}</span>}
        <span>執行步驟</span>
        <span className="opacity-60">({stepLines.length})</span>
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
      </button>
      
      {isExpanded && (
        <div className="mt-2 px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600 font-mono">
          {stepLines.map((line, idx) => (
            <div key={idx} className="py-0.5">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Agent 頭像 + 名稱標籤
 * Pandora: 使用 /PandoraH.PNG 圖片
 * Moana: 使用 /MoanaH.png 圖片
 * Paul: 使用 /PaulH.png 圖片
 * Stacey (host): 使用 /StaceyH.png 圖片
 * 
 * 注意：不使用 fallback，避免誤植 agent name
 * 如果沒有明確的 agentId，就不顯示任何頭像
 */
function AgentAvatar({ agentId, agentName }: { agentId?: string; agentName?: string }) {
  // 沒有明確的 agentId 就不顯示（避免誤植）
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

export function MessageBubble({ message, fullWidth }: { message: Message; fullWidth?: boolean }) {
  const isUser = message.role === 'user';

  // 排隊中的佔位泡（系統忙碌時訊息已入佇列）——必須在空內容檢查之前，
  // 否則 content 為空會直接 return null，用戶看不到任何回饋
  if (!isUser && message.status === 'queued') {
    return (
      <div className={`flex justify-start ${fullWidth ? '' : 'mb-4'}`}>
        <div className="px-4 py-3 bg-white text-gray-500 border border-gray-200 rounded-2xl shadow-sm flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
          <span className="text-sm">已排入佇列，將於目前任務完成後處理…</span>
        </div>
      </div>
    );
  }

  // 檢查 assistant 訊息是否有實際內容
  const hasContent = isUser ||
    message.content ||
    (message.chunks && message.chunks.length > 0) ||
    (message.toolCalls && message.toolCalls.length > 0) ||
    message.trendData ||
    message.trendDatasets ||
    message.chartConfig ||
    message.htmlVisualization ||
    (message.htmlVisualizations && message.htmlVisualizations.length > 0) ||
    message.data;

  // 如果沒有內容，不渲染氣泡
  if (!hasContent) {
    return null;
  }

  // 檢查是否為 loading 狀態（沒有文字、沒有工具、沒有數據）
  const hasHtmlViz = message.htmlVisualization || (message.htmlVisualizations && message.htmlVisualizations.length > 0);
  const isLoadingState = !isUser && !message.content &&
    (!message.toolCalls || message.toolCalls.length === 0) &&
    (!message.chunks || message.chunks.length === 0) &&
    !message.data && !message.trendData && !message.chartConfig && !hasHtmlViz;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${fullWidth ? '' : 'mb-4'}`}>
      <div
        className={`${fullWidth ? 'w-full' : isUser ? 'max-w-[90%]' : 'max-w-[90%] min-w-[360px] sm:min-w-[520px]'} rounded-2xl shadow-sm ${
          isUser
            ? 'px-5 py-4 bg-primary-600 text-white'
            : isLoadingState
              ? 'px-4 py-3 bg-white text-gray-800 border border-gray-200'
              : 'px-5 py-4 bg-white text-gray-800 border border-gray-200'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{renderUserMessageWithMentions(message.content)}</p>
        ) : (
          <div className="space-y-2">
            {/* A2A Agent Identity */}
            <AgentAvatar agentId={message.agentId} agentName={message.agentName} />
            
            {/* Review Badge for Host Agent */}
            {message.isReview && message.agentId === 'host' && (
              message.isReviewComplete ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-600 text-xs font-medium mb-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Reviewed</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium mb-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <span>Reviewing</span>
                </div>
              )
            )}
            
            {/* Tool Execution Display — placeholder; real ToolExecution wasn't ported */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <ToolCallsList toolCalls={message.toolCalls} />
            )}

            {/* Agent 最終推理思考 */}
            {message.thought && (
              <div className="px-4 py-2.5 rounded-lg bg-amber-50/70 border border-amber-200/50">
                <div className="flex items-start gap-2">
                  <span className="text-amber-500 text-sm flex-shrink-0 mt-0.5">💭</span>
                  <p className="text-xs text-amber-700 leading-relaxed">{message.thought}</p>
                </div>
              </div>
            )}
            
            {/* HTML Visualizations (multiple supported) */}
            {(() => {
              const htmlVizList = message.htmlVisualizations && message.htmlVisualizations.length > 0
                ? message.htmlVisualizations
                : message.htmlVisualization
                  ? [message.htmlVisualization]
                  : [];
              return htmlVizList
                .filter((viz: any) => viz && viz.html)
                .map((viz: any, idx: number) => (
                  <HtmlVisualizationRenderer key={idx} visualization={viz} />
                ));
            })()}
            
            {/* Charts - MultiLine or Single Trend */}
            {!hasHtmlViz && message.trendDatasets && message.trendDatasets.length > 1 ? (
              <MultiLineChart
                datasets={message.trendDatasets}
                chartConfig={message.chartConfig}
              />
            ) : !hasHtmlViz && message.trendData && message.trendData.length > 0 ? (
              <TrendChart
                data={message.trendData}
                title={message.chartConfig?.title}
              />
            ) : null}

            {/* Dynamic Charts (AI-designed) — multiple charts supported */}
            {/* Charts can render even without message.data if config has bound data snapshot */}
            {!hasHtmlViz && !message.trendData && (() => {
              const configs: any[] = (message as any).chartConfigs && (message as any).chartConfigs.length > 0
                ? (message as any).chartConfigs
                : message.chartConfig
                  ? [message.chartConfig]
                  : [];
              if (configs.length === 0) return null;
              // Only render if we have either message.data or config has bound data
              const hasData = message.data || configs.some((cfg: any) => cfg.data && cfg.data.length > 0);
              if (!hasData) return null;
              return configs.map((cfg: any, idx: number) => (
                <DynamicChart key={`chart-${idx}`} config={cfg} data={message.data || []} />
              ));
            })()}
            
            {/* Posts Table - 文章列表（分頁顯示）
                只有當數據看起來像社群文章時才顯示（有 source/title/url 等欄位）
            */}
            {message.data && message.data.length > 0 && !message.chartConfig && !(message as any).chartConfigs?.length && (() => {
              // Check if data looks like social media posts (has characteristic fields)
              const firstItem = message.data![0];
              const looksLikePosts = firstItem && (
                'source' in firstItem || 
                'url' in firstItem || 
                'forumName' in firstItem ||
                'postId' in firstItem
              );
              if (!looksLikePosts) return null;
              // 多品牌/多查詢並行：用 tab 切換各自的文章列表（資料來自 searchResultsByQuery）
              const articleGroups = (message.searchResultsByQuery || []).filter(
                (g) => g && typeof g.queryLabel === 'string' && /articles/i.test(g.queryLabel) && Array.isArray(g.data) && g.data.length > 0
              );
              if (articleGroups.length >= 2) {
                return <BrandArticleTabs groups={articleGroups} />;
              }
              return (
                <PostsTable
                  data={message.data!}
                  title="搜尋結果"
                  pageSize={15}
                />
              );
            })()}
            
            {/* 數據過期提示（90 天 TTL） */}
            {message.dataExpired && (
              <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>📊</span>
                  <span>原始數據已過期（超過 90 天）</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  文字內容與對話結構已保留，但文章列表與圖表數據不再可見。
                </p>
              </div>
            )}
            
            {/* Chunk-based rendering */}
            {message.chunks?.map((chunk: MessageContent, idx: number) => {
              switch (chunk.type) {
                case 'text': {
                  const { mainContent, taskStepsList } = parseTaskSteps(chunk.content as string);
                  return (
                    <React.Fragment key={idx}>
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {mainContent}
                        </ReactMarkdown>
                      </div>
                      {taskStepsList.length > 0 && (
                        <div className="flex flex-col gap-1 mt-2">
                          {taskStepsList.map((item, stepIdx) => (
                            <TaskStepsChip key={stepIdx} steps={item.steps} agentName={item.agentName} />
                          ))}
                        </div>
                      )}
                    </React.Fragment>
                  );
                }
                case 'schema':
                  return <SchemaDisplay key={idx} schema={chunk.content as SchemaContent} />;
                case 'sql':
                  // SQL 已在 ToolExecution 中顯示，不需要重複
                  if (message.toolCalls && message.toolCalls.length > 0) {
                    return null;
                  }
                  return <SqlDisplay key={idx} sql={chunk.content as string} />;
                case 'data':
                  // 數據已由 PostsTable 顯示，不需要重複
                  if (message.data && message.data.length > 0) {
                    return null;
                  }
                  return <DataTable key={idx} data={chunk.content as DataContent} />;
                case 'chart':
                  // Only show Vega chart if no chart is already rendered
                  if (!message.trendData && !message.chartConfig) {
                    return <ChartDisplay key={idx} spec={chunk.content} />;
                  }
                  return null;
                case 'error':
                  return (
                    <div key={idx} className="text-red-600 bg-red-50 rounded-lg p-3 text-sm">
                      Error: {chunk.content}
                    </div>
                  );
                default:
                  return null;
              }
            })}
            {!message.chunks?.length && message.content && (() => {
              const { mainContent, taskStepsList } = parseTaskSteps(message.content);
              return (
                <>
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {mainContent}
                    </ReactMarkdown>
                  </div>
                  {taskStepsList.length > 0 && (
                    <div className="flex flex-col gap-1 mt-2">
                      {taskStepsList.map((item, stepIdx) => (
                        <TaskStepsChip key={stepIdx} steps={item.steps} agentName={item.agentName} />
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
        <div
          className={`text-xs mt-2 ${
            isUser ? 'text-primary-200' : 'text-gray-400'
          }`}
        >
          {message.timestamp.toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}

export default MessageBubble;
