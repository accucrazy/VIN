'use client';

import React, { useState } from 'react';
import { PostsTable } from '@/components/chat';

interface ArticleGroup {
  queryLabel: string;
  question: string;
  data: any[];
}

/** 從 question 取出簡短標籤，如 "Brand articles: 全家+FamilyMart" → "全家" */
function shortLabel(group: ArticleGroup, index: number): string {
  const q = (group.question || '')
    .replace(/^Brand articles:\s*/i, '')
    .replace(/^Brand trend:\s*/i, '')
    .trim();
  const base = (q.split('+')[0] || '').trim() || q || group.queryLabel || `查詢 ${index + 1}`;
  return base.length > 14 ? base.slice(0, 14) + '…' : base;
}

/**
 * 多品牌/多查詢文章列表 — 用 tab 切換各自的文章列表，呼應趨勢疊圖的多品牌呈現。
 * 資料來自 agent 的 searchResultsByQuery（每個 analyze_brand / 查詢各一組）。
 * 只在有 2 組以上時由 MessageBubble 啟用；單組仍走原本的單一 PostsTable。
 */
export function BrandArticleTabs({ groups }: { groups: ArticleGroup[] }) {
  const [active, setActive] = useState(0);
  const current = groups[active] ?? groups[0];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5 mb-1">
        {groups.map((g, i) => (
          <button
            key={`${g.queryLabel}-${i}`}
            onClick={() => setActive(i)}
            title={g.question}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              i === active
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
            }`}
          >
            {shortLabel(g, i)}
            <span className="ml-1 opacity-70">({g.data.length})</span>
          </button>
        ))}
      </div>
      {/* key={active}：切換 tab 時重置分頁/排序，避免上一品牌的頁碼殘留 */}
      <PostsTable
        key={active}
        data={current.data}
        title={`搜尋結果 — ${shortLabel(current, active)}`}
        pageSize={15}
        defaultCollapsed={false}
      />
    </div>
  );
}

export default BrandArticleTabs;
