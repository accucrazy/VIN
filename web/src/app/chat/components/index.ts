/**
 * Chat Components Export
 * 
 * 聊天頁面相關組件統一匯出
 */

// ============================================================
// Layout Components (New)
// ============================================================
export { ChatLayout } from './layout/ChatLayout';
export { ChatHeader } from './layout/ChatHeader';

// ============================================================
// Sidebar Components (New)
// ============================================================
export { CollapsibleSidebar } from './sidebar/CollapsibleSidebar';
export { SidebarHeader } from './sidebar/SidebarHeader';
export { ConversationList } from './sidebar/ConversationList';

// ============================================================
// Input Components (New)
// ============================================================
export { GeminiStyleInput } from './input/GeminiStyleInput';

// ============================================================
// Messages Components (New)
// ============================================================
export { MessagesArea } from './messages/MessagesArea';

// ============================================================
// Legacy Components — NOT migrated from the-pocket-pandora
// ============================================================
// The following were intentionally skipped (they were already legacy upstream):
//   - MessageInput        → replaced by GeminiStyleInput
//   - ConversationSidebar → replaced by CollapsibleSidebar + ConversationList

// 訊息氣泡
export { MessageBubble } from './MessageBubble';

// 附件預覽
export { FileAttachmentBar } from './FileAttachmentBar';

// 工具狀態指示器
export { AgentToolIndicator, TOOL_MAPPING } from './AgentToolIndicator';
export type { AgentToolIndicatorProps } from './AgentToolIndicator';

// Markdown 渲染組件
export { markdownComponents } from './MarkdownComponents';

// 數據顯示組件
export * from './displays';
