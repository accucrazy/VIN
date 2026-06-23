'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { FileAttachmentBar } from '../FileAttachmentBar';
import type { FileAttachment } from '../../types';
import { isEnterWithoutIME } from '@/lib/utils/keyboard';
import { AgentMentionDropdown, AVAILABLE_AGENTS, type AgentInfo } from './AgentMentionDropdown';

interface GeminiStyleInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileSelect: () => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  isLoading: boolean;
  isDragOver: boolean;
  attachments: FileAttachment[];
  onRemoveAttachment: (id: string) => void;
  disabled?: boolean;
}

/**
 * Agent 名稱對應顏色 — 對齊 VIN 的 agent registry。
 * 目前 highlight overlay 已停用（見下方註解），只保留色票供未來重啟使用。
 */
const AGENT_COLORS: Record<string, string> = {
  Vin: 'text-brand-600',
  vin: 'text-brand-600',
  Researcher: 'text-emerald-600',
  researcher: 'text-emerald-600',
};

/**
 * 檢測 @ mention 的正則表達式
 * 匹配游標前面的 @xxx 模式
 */
function detectMention(text: string, cursorPos: number): { 
  hasMention: boolean; 
  filter: string; 
  startPos: number;
} {
  const textBeforeCursor = text.slice(0, cursorPos);
  // 匹配 @ 後面可選的字母（不含空格）
  const match = textBeforeCursor.match(/@(\w*)$/);
  
  if (match) {
    return {
      hasMention: true,
      filter: match[1],
      startPos: cursorPos - match[0].length,
    };
  }
  
  return { hasMention: false, filter: '', startPos: -1 };
}

/**
 * 將文字中的 @Agent 轉換為帶顏色的 HTML
 */
function renderHighlightedText(text: string): React.ReactNode {
  if (!text) return null;

  const mentionRegex = /@(Vin|Researcher)\b/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = mentionRegex.exec(text)) !== null) {
    // 添加 mention 前的普通文字
    if (match.index > lastIndex) {
      parts.push(
        <span key={keyIndex++}>{text.slice(lastIndex, match.index)}</span>
      );
    }
    
    // 添加帶顏色的 @Agent
    const agentName = match[1];
    const colorClass = AGENT_COLORS[agentName] || 'text-gray-700';
    parts.push(
      <span key={keyIndex++} className={`font-semibold ${colorClass}`}>
        @{agentName}
      </span>
    );
    
    lastIndex = match.index + match[0].length;
  }

  // 添加剩餘的文字
  if (lastIndex < text.length) {
    parts.push(<span key={keyIndex++}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : text;
}

/**
 * Gemini-style Input Component
 * 
 * Pill-shaped input area without explicit send button.
 * Press Enter to send, Shift+Enter for new line.
 * Supports @Agent mention with autocomplete and colored highlighting.
 */
export function GeminiStyleInput({
  value,
  onChange,
  onSend,
  onFileSelect,
  onPaste,
  onDrop,
  onDragOver,
  onDragLeave,
  isLoading,
  isDragOver,
  attachments,
  onRemoveAttachment,
  disabled = false,
}: GeminiStyleInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // @ Mention 狀態
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionStartPos, setMentionStartPos] = useState(-1);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  // Reset textarea height when value is cleared externally (e.g., after sending)
  useEffect(() => {
    if (inputRef.current) {
      if (value === '') {
        inputRef.current.style.height = 'auto';
      } else {
        // Recalculate height when value changes externally
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
      }
    }
  }, [value]);

  // 同步 highlight 層的滾動位置
  useEffect(() => {
    const syncScroll = () => {
      if (inputRef.current && highlightRef.current) {
        highlightRef.current.scrollTop = inputRef.current.scrollTop;
        highlightRef.current.scrollLeft = inputRef.current.scrollLeft;
      }
    };
    
    const textarea = inputRef.current;
    if (textarea) {
      textarea.addEventListener('scroll', syncScroll);
      return () => textarea.removeEventListener('scroll', syncScroll);
    }
  }, []);

  /**
   * 更新 mention 下拉位置
   */
  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current || !containerRef.current) return;
    
    // 簡單定位：固定在輸入框上方
    setDropdownPosition({
      top: 8, // 距離輸入框上方 8px
      left: 12, // 左側對齊
    });
  }, []);

  /**
   * 處理 @ mention 選取
   */
  const handleMentionSelect = useCallback((agent: AgentInfo) => {
    if (mentionStartPos < 0) return;
    
    const cursorPos = inputRef.current?.selectionStart || value.length;
    const beforeMention = value.slice(0, mentionStartPos);
    const afterMention = value.slice(cursorPos);
    
    // 插入 @AgentName + 空格
    const newValue = `${beforeMention}@${agent.name} ${afterMention}`;
    onChange(newValue);
    
    // 關閉下拉選單
    setShowMentionDropdown(false);
    setMentionFilter('');
    setMentionStartPos(-1);
    setHighlightedIndex(0);
    
    // 重新聚焦並設定游標位置
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = mentionStartPos + agent.name.length + 2; // @Name + space
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [value, mentionStartPos, onChange]);

  /**
   * 處理鍵盤事件
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 如果下拉選單開啟，優先處理導航
    if (showMentionDropdown) {
      const filteredAgents = AVAILABLE_AGENTS.filter(agent =>
        agent.name.toLowerCase().startsWith(mentionFilter.toLowerCase())
      );
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < filteredAgents.length - 1 ? prev + 1 : 0
        );
        return;
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredAgents.length - 1
        );
        return;
      }
      
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (filteredAgents.length > 0) {
          handleMentionSelect(filteredAgents[highlightedIndex]);
        }
        return;
      }
      
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionDropdown(false);
        return;
      }
    }
    
    // 正常的 Enter 送出邏輯
    if (isEnterWithoutIME(e) && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  /**
   * 處理輸入變化
   */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
    
    const newValue = target.value;
    const cursorPos = target.selectionStart;
    
    onChange(newValue);
    
    // 檢測 @ mention
    const { hasMention, filter, startPos } = detectMention(newValue, cursorPos);
    
    if (hasMention) {
      setShowMentionDropdown(true);
      setMentionFilter(filter);
      setMentionStartPos(startPos);
      setHighlightedIndex(0);
      updateDropdownPosition();
    } else {
      setShowMentionDropdown(false);
      setMentionFilter('');
      setMentionStartPos(-1);
    }
  };

  /**
   * 處理游標位置變化（點擊或方向鍵移動）
   */
  const handleSelect = () => {
    if (!inputRef.current) return;
    
    const cursorPos = inputRef.current.selectionStart;
    const { hasMention, filter, startPos } = detectMention(value, cursorPos);
    
    if (hasMention) {
      setShowMentionDropdown(true);
      setMentionFilter(filter);
      setMentionStartPos(startPos);
      updateDropdownPosition();
    } else {
      setShowMentionDropdown(false);
    }
  };

  // NOTE: 上游 the-pocket-pandora 用「透明 textarea + 彩色 highlight 層」做 @mention 上色，
  // 但這個 overlay 容易跟字級/行高/IME 失去同步，造成「打字看不到字」的回報。
  // VIN 這份 port 直接停用 overlay：textarea 永遠用實體 text-gray-900。
  // 真要重啟，把下面這行改回 `/@(Vin|Researcher)\b/i.test(value)` 並把 overlay block 改回條件渲染即可。
  const hasMentionInValue = false;

  return (
    <div className="px-4 md:px-6 pb-3 pt-2">
      <div className="max-w-3xl mx-auto">
        {/* Attachments preview */}
        <FileAttachmentBar
          attachments={attachments}
          onRemove={onRemoveAttachment}
        />

        {/* Floating input container - Gemini style */}
        <div
          ref={containerRef}
          className={`
            relative flex flex-col rounded-2xl px-3 py-2
            transition-all duration-200
            border
            ${isDragOver
              ? 'bg-primary-50 border-primary-300 shadow-lg'
              : 'bg-white border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.08)]'
            }
          `}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {/* @ Mention Dropdown */}
          {showMentionDropdown && (
            <AgentMentionDropdown
              filter={mentionFilter}
              highlightedIndex={highlightedIndex}
              onSelect={handleMentionSelect}
              onHighlightChange={setHighlightedIndex}
              position={dropdownPosition}
            />
          )}

          {/* Text input with highlight overlay */}
          <div className="relative w-full">
            {/* Highlight layer (shows colored @mentions) */}
            {hasMentionInValue && (
              <div
                ref={highlightRef}
                className="absolute inset-0 pointer-events-none text-sm leading-6 whitespace-pre-wrap break-words overflow-hidden text-gray-700"
                aria-hidden="true"
              >
                {renderHighlightedText(value)}
              </div>
            )}
            
            {/* Actual textarea (transparent text when has mentions) */}
            <textarea
              ref={inputRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onSelect={handleSelect}
              onPaste={onPaste}
              placeholder={isDragOver ? '放開以新增檔案...' : '輸入您的問題... (輸入 @ 選擇 Agent)'}
              disabled={isLoading || disabled}
              rows={1}
              className="
                w-full bg-transparent outline-none resize-none text-[15px]
                placeholder:text-gray-400 placeholder:font-normal
                min-h-[24px] max-h-[120px] leading-6
                font-semibold caret-brand-600
                disabled:opacity-50 disabled:cursor-not-allowed
              "
              // 上游 Tailwind preflight 對 textarea 設 `color: inherit`，加上 webkit user-agent
              // style 偶爾會吃掉 class 上的 text-*；用 inline style 強制鎖死真實的深色值。
              style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}
            />
          </div>

          {/* Bottom row - buttons */}
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1">
              {/* File attachment button */}
              <button
                type="button"
                onClick={onFileSelect}
                disabled={isLoading || disabled}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full 
                           transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="上傳檔案"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {/* Loading indicator on right */}
            {isLoading && (
              <div className="p-1">
                <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* AI disclaimer */}
        <p className="text-[11px] text-gray-400 text-center mt-2">
          AI 回應可能產生誤差，重要資訊建議查證。
        </p>
      </div>
    </div>
  );
}

export default GeminiStyleInput;
