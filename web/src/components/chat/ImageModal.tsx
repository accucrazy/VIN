'use client';

import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

interface ImageModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  alt?: string;
  /** 如果是 data URI，提供下載功能 */
  downloadFilename?: string;
}

/**
 * 圖片放大模態框
 * 點擊圖片或背景關閉，支援 ESC 鍵關閉
 * 參考 MoanaG 設計
 */
export default function ImageModal({ 
  imageUrl, 
  isOpen, 
  onClose, 
  alt = 'Image',
  downloadFilename 
}: ImageModalProps) {
  // 按 ESC 鍵關閉
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // 防止背景滾動
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* 背景遮罩 - 點擊關閉 */}
      <div 
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] animate-fadeIn cursor-zoom-out"
        onClick={onClose}
      />
      
      {/* 圖片容器 */}
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 pointer-events-none">
        <div className="relative max-w-[95vw] max-h-[95vh] animate-scaleIn pointer-events-auto">
          {/* 頂部工具列 */}
          <div className="absolute -top-12 right-0 flex items-center gap-3">
            {/* 下載按鈕 */}
            {downloadFilename && (
              <a
                href={imageUrl}
                download={downloadFilename}
                className="p-2 text-white/70 hover:text-white transition-colors"
                title="下載圖片"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="w-5 h-5" />
              </a>
            )}
            {/* 關閉按鈕 */}
            <button
              onClick={onClose}
              className="p-2 text-white/70 hover:text-white transition-colors"
              aria-label="關閉圖片"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          {/* 主圖片 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={alt}
            className="w-auto h-auto max-w-full max-h-[90vh] rounded-lg shadow-2xl cursor-zoom-out"
            onClick={onClose}
            onLoad={(e) => {
              // 圖片載入後的 smooth 動畫
              e.currentTarget.style.opacity = '1';
            }}
            style={{ opacity: 0, transition: 'opacity 0.3s ease-in-out' }}
          />
          
          {/* 圖片說明文字 */}
          {alt && alt !== 'Image' && (
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg">
              <p className="text-white text-sm text-center">{alt}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
