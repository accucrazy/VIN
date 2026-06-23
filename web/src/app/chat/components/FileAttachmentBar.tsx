/**
 * FileAttachmentBar Component
 * 
 * 顯示已選擇的附件預覽（圖片縮圖 / 文件圖標 + 檔名）
 * 橫向排列，可滾動，每個附件可移除
 */

'use client';

import React from 'react';
import { X, FileText, FileSpreadsheet, Presentation, File, Image as ImageIcon } from 'lucide-react';
import type { FileAttachment } from '../types';
import { isImageType, formatFileSize, getFileTypeLabel } from '../types';

interface FileAttachmentBarProps {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
}

/**
 * 根據 MIME 類型取得對應圖標
 */
function getFileIcon(mimeType: string) {
  if (isImageType(mimeType)) return ImageIcon;
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType.includes('wordprocessingml')) return FileText;
  if (mimeType.includes('spreadsheetml')) return FileSpreadsheet;
  if (mimeType.includes('presentationml')) return Presentation;
  return File;
}

/**
 * 根據 MIME 類型取得對應顏色
 */
function getFileColor(mimeType: string): string {
  if (isImageType(mimeType)) return 'text-violet-500 bg-violet-50 border-violet-200';
  if (mimeType === 'application/pdf') return 'text-red-500 bg-red-50 border-red-200';
  if (mimeType.includes('wordprocessingml')) return 'text-blue-500 bg-blue-50 border-blue-200';
  if (mimeType.includes('spreadsheetml')) return 'text-emerald-500 bg-emerald-50 border-emerald-200';
  if (mimeType.includes('presentationml')) return 'text-orange-500 bg-orange-50 border-orange-200';
  return 'text-gray-500 bg-gray-50 border-gray-200';
}

export function FileAttachmentBar({ attachments, onRemove }: FileAttachmentBarProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 px-4 py-2 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300">
      {attachments.map((attachment) => {
        const isImage = isImageType(attachment.mimeType);

        return (
          <div
            key={attachment.id}
            className="relative flex-shrink-0 group"
          >
            {isImage && attachment.previewUrl ? (
              // ==================== 圖片預覽 ====================
              <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                <img
                  src={attachment.previewUrl}
                  alt={attachment.filename}
                  className="w-full h-full object-cover"
                />
                {/* 載入中覆蓋層 */}
                {attachment.loading && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {/* 移除按鈕 */}
                <button
                  onClick={() => onRemove(attachment.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              // ==================== 文件預覽 ====================
              <div className={`
                relative flex items-center gap-2 px-3 py-2 rounded-lg border
                ${getFileColor(attachment.mimeType)}
              `}>
                {/* 圖標 */}
                {React.createElement(getFileIcon(attachment.mimeType), {
                  className: 'w-4 h-4 flex-shrink-0',
                })}
                {/* 檔名 + 大小 */}
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate max-w-[120px]">
                    {attachment.filename}
                  </p>
                  <p className="text-[10px] opacity-60">
                    {getFileTypeLabel(attachment.mimeType)} · {formatFileSize(attachment.size)}
                  </p>
                </div>
                {/* 載入中 */}
                {attachment.loading && (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
                {/* 移除按鈕 */}
                <button
                  onClick={() => onRemove(attachment.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default FileAttachmentBar;
