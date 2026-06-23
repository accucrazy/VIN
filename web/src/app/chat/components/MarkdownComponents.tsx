/**
 * MarkdownComponents
 * 
 * ReactMarkdown 自訂樣式組件
 */

'use client';

import React, { useState } from 'react';
import ImageModal from '@/components/chat/ImageModal';

/**
 * Agent mention 顏色對應
 * 用於高亮 @Pandora、@Paul 等 mention
 */
const AGENT_MENTION_COLORS: Record<string, string> = {
  Pandora: 'text-indigo-600',
  pandora: 'text-indigo-600',
  Moana: 'text-pink-600',
  moana: 'text-pink-600',
  Paul: 'text-emerald-600',
  paul: 'text-emerald-600',
  Stacey: 'text-blue-600',
  stacey: 'text-blue-600',
};

/**
 * 處理文字中的 @Agent mentions
 * 將 @Pandora、@Paul 等轉換為帶顏色的粗體 span
 */
const processAgentMentions = (children: React.ReactNode): React.ReactNode => {
  if (typeof children === 'string') {
    const mentionRegex = /@(Pandora|pandora|Moana|moana|Paul|paul|Stacey|stacey)\b/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let keyIndex = 0;

    while ((match = mentionRegex.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push(children.slice(lastIndex, match.index));
      }
      const agentName = match[1];
      const colorClass = AGENT_MENTION_COLORS[agentName] || 'text-gray-600';
      parts.push(
        <span key={keyIndex++} className={`font-bold ${colorClass}`}>
          @{agentName.charAt(0).toUpperCase() + agentName.slice(1).toLowerCase()}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < children.length) {
      parts.push(children.slice(lastIndex));
    }

    return parts.length > 0 ? parts : children;
  }

  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <React.Fragment key={idx}>{processAgentMentions(child)}</React.Fragment>
    ));
  }

  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: React.ReactNode }>;
    if (element.props.children) {
      return React.cloneElement(element, {
        ...element.props,
        children: processAgentMentions(element.props.children),
      });
    }
  }

  return children;
};

/**
 * 可點擊放大的圖片組件
 * 支援 Firebase Storage / canvas 生成的圖片點擊放大顯示
 */
const ClickableImage = ({ src, alt, ...props }: { src: string; alt?: string; [key: string]: any }) => {
  const [modalOpen, setModalOpen] = useState(false);
  
  const invalidPatterns = [
    'oaiusercontent.com',
    'example.com',
    'placeholder',
    'xxx',
    'undefined',
  ];
  
  const isInvalidUrl = !src || 
    invalidPatterns.some(pattern => src.toLowerCase().includes(pattern)) ||
    (!src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/'));
  
  if (isInvalidUrl) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-500">
        🖼️ {alt || '圖片'}（請使用「生成圖片」功能）
      </span>
    );
  }
  
  const downloadFilename = `image-${Date.now()}.png`;
  
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img 
        src={src} 
        alt={alt || '圖片'} 
        className="max-w-full h-auto rounded-lg my-2 shadow-sm border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity" 
        style={{ maxHeight: '500px', objectFit: 'contain' }}
        loading="lazy"
        onClick={() => setModalOpen(true)}
        title="點擊放大圖片"
        {...props} 
      />
      <ImageModal
        imageUrl={src}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        alt={alt || '圖片'}
        downloadFilename={downloadFilename}
      />
    </>
  );
};

export const markdownComponents = {
  // Tables
  table: ({ children, ...props }: any) => (
    <div className="overflow-x-auto my-4 rounded-lg border border-gray-300">
      <table className="min-w-full divide-y divide-gray-300 text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: any) => (
    <thead className="bg-primary-50" {...props}>{children}</thead>
  ),
  tbody: ({ children, ...props }: any) => (
    <tbody className="divide-y divide-gray-200 bg-white" {...props}>{children}</tbody>
  ),
  tr: ({ children, ...props }: any) => (
    <tr className="hover:bg-gray-50 transition-colors" {...props}>{children}</tr>
  ),
  th: ({ children, ...props }: any) => (
    <th className="px-4 py-3 text-left text-xs font-bold text-primary-700 uppercase tracking-wider border-r border-gray-200 last:border-r-0" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: any) => (
    <td className="px-4 py-3 text-gray-700 border-r border-gray-100 last:border-r-0" {...props}>
      {children}
    </td>
  ),
  // Text - 處理 @Agent mentions
  p: ({ children, ...props }: any) => (
    <p className="mb-3 leading-relaxed last:mb-0" {...props}>{processAgentMentions(children)}</p>
  ),
  // Lists with better indentation
  ul: ({ children, ...props }: any) => (
    <ul className="list-disc ml-5 mb-3 space-y-2" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: any) => (
    <ol className="list-decimal ml-5 mb-3 space-y-2" {...props}>{children}</ol>
  ),
  li: ({ children, ...props }: any) => (
    <li className="text-gray-700 leading-relaxed pl-1" {...props}>{processAgentMentions(children)}</li>
  ),
  // Emphasis
  strong: ({ children, ...props }: any) => (
    <strong className="font-bold text-gray-900" {...props}>{children}</strong>
  ),
  em: ({ children, ...props }: any) => (
    <em className="italic text-gray-700" {...props}>{children}</em>
  ),
  // Headings with better spacing
  h1: ({ children, ...props }: any) => (
    <h1 className="text-xl font-bold mt-4 mb-3 text-gray-900 border-b border-gray-200 pb-2" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: any) => (
    <h2 className="text-lg font-bold mt-4 mb-2 text-gray-900" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: any) => (
    <h3 className="text-base font-bold mt-3 mb-2 text-gray-800" {...props}>{children}</h3>
  ),
  h4: ({ children, ...props }: any) => (
    <h4 className="text-sm font-bold mt-2 mb-1 text-gray-800" {...props}>{children}</h4>
  ),
  // Code
  code: ({ children, inline, ...props }: any) => 
    inline ? (
      <code className="bg-gray-200 px-1.5 py-0.5 rounded text-sm font-mono text-primary-700" {...props}>{children}</code>
    ) : (
      <code className="block bg-gray-800 text-green-400 p-4 rounded-lg text-sm font-mono overflow-x-auto my-3" {...props}>{children}</code>
    ),
  // Blockquote for highlighted content
  blockquote: ({ children, ...props }: any) => (
    <blockquote className="border-l-4 border-primary-400 bg-primary-50 pl-4 py-2 my-3 rounded-r-lg" {...props}>
      {children}
    </blockquote>
  ),
  // Horizontal rule
  hr: ({ ...props }: any) => (
    <hr className="my-4 border-gray-300" {...props} />
  ),
  // Links
  a: ({ children, href, ...props }: any) => (
    <a href={href} className="text-primary-600 hover:text-primary-800 underline" target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
  // Images - 使用 ClickableImage 組件支援點擊放大
  img: ({ src, alt, ...props }: any) => (
    <ClickableImage src={src} alt={alt} {...props} />
  ),
};

export default markdownComponents;
