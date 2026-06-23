/**
 * Chat 頁面共用型別定義
 */

// ============================================================
// 檔案附件
// ============================================================

/**
 * 前端附件（含 File 物件，用於預覽）
 */
export interface FileAttachment {
  /** 唯一識別（用於 key） */
  id: string;
  /** 原始 File 物件 */
  file: File;
  /** 檔案名稱 */
  filename: string;
  /** MIME 類型 */
  mimeType: string;
  /** 檔案大小（bytes） */
  size: number;
  /** Base64 編碼的檔案數據 */
  base64Data: string;
  /** 圖片預覽 URL（僅圖片類型） */
  previewUrl?: string;
  /** 是否正在讀取 */
  loading?: boolean;
}

/**
 * API 傳送用附件（不含 File 物件）
 */
export interface ApiAttachment {
  filename: string;
  mimeType: string;
  base64Data: string;
  size: number;
}

// ============================================================
// 支援的檔案類型
// ============================================================

/** 支援的圖片 MIME 類型 */
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
] as const;

/** 支援的音訊 MIME 類型（Gemini 原生支援） */
export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg',       // mp3
  'audio/wav',        // wav
  'audio/ogg',        // ogg
  'audio/webm',       // webm audio
  'audio/aac',        // aac
  'audio/flac',       // flac
] as const;

/** 支援的影片 MIME 類型（Gemini 原生支援） */
export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',        // mp4
  'video/webm',       // webm
  'video/mpeg',       // mpeg
  'video/quicktime',  // mov
] as const;

/** 支援的文件 MIME 類型 */
export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',          // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',  // pptx
] as const;

/** 所有支援的 MIME 類型 */
export const ALL_SUPPORTED_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_AUDIO_TYPES,
  ...SUPPORTED_VIDEO_TYPES,
  ...SUPPORTED_DOCUMENT_TYPES,
] as const;

/** file input accept 字串 */
export const FILE_ACCEPT = [
  // 圖片
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  // 音訊
  '.mp3',
  '.wav',
  '.ogg',
  '.aac',
  '.flac',
  // 影片
  '.mp4',
  '.webm',
  '.mpeg',
  '.mov',
  // 文件
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
].join(',');

// ============================================================
// 限制
// ============================================================

/** 
 * 單檔最大 50MB
 * 
 * Gemini inlineData 上限為 100MB（PDF 為 50MB）。
 * 超過 20MB 的檔案會自動使用 Files API 上傳（最大支援 2GB）。
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 單次最多 5 個檔案 */
export const MAX_FILES = 5;

/** 總大小最大 100MB */
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

// ============================================================
// 工具函數
// ============================================================

/** 判斷是否為圖片類型 */
export function isImageType(mimeType: string): boolean {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

/** 判斷是否為音訊類型 */
export function isAudioType(mimeType: string): boolean {
  return (SUPPORTED_AUDIO_TYPES as readonly string[]).includes(mimeType);
}

/** 判斷是否為影片類型 */
export function isVideoType(mimeType: string): boolean {
  return (SUPPORTED_VIDEO_TYPES as readonly string[]).includes(mimeType);
}

/** 判斷是否為支援的檔案類型 */
export function isSupportedType(mimeType: string): boolean {
  return (ALL_SUPPORTED_TYPES as readonly string[]).includes(mimeType);
}

/** 格式化檔案大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 根據 MIME 類型取得檔案類別標籤 */
export function getFileTypeLabel(mimeType: string): string {
  if (isImageType(mimeType)) return '圖片';
  if (isAudioType(mimeType)) return '音訊';
  if (isVideoType(mimeType)) return '影片';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('wordprocessingml')) return 'Word';
  if (mimeType.includes('spreadsheetml')) return 'Excel';
  if (mimeType.includes('presentationml')) return 'PPT';
  return '檔案';
}

/**
 * 讀取檔案為 base64
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:xxx;base64, 前綴
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}
