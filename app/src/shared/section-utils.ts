/**
 * Section 工具函数
 * 用于解析和构建 section 文件夹名
 *
 * 文件夹命名规范: {序号}_{媒体类型}_{名称}
 * 示例: 1_视频_源视频, 2_图片_源角色图片, 3_提示词_提示词
 */

import type { MediaType, SectionDescriptor } from './types';

/** 合法的媒体类型集合 */
const VALID_MEDIA_TYPES: Set<string> = new Set(['视频', '图片', '提示词', '声音']);

/** 文件夹名解析正则: {序号}_{媒体类型}_{名称} */
const FOLDER_NAME_REGEX = /^(\d+)_([^_]+)_(.+)$/;

/**
 * 从文件夹名解析出 SectionDescriptor
 * @returns null 表示不符合命名规范
 */
export function parseFolderName(name: string): SectionDescriptor | null {
  const match = name.match(FOLDER_NAME_REGEX);
  if (!match) return null;

  const order = parseInt(match[1], 10);
  const mediaType = match[2];
  const label = match[3];

  if (!VALID_MEDIA_TYPES.has(mediaType)) return null;
  if (order < 1 || order > 99) return null;

  return {
    id: name,
    order,
    mediaType: mediaType as MediaType,
    label,
  };
}

/**
 * 构建文件夹名
 */
export function buildFolderName(order: number, mediaType: MediaType, label: string): string {
  return `${order}_${mediaType}_${label}`;
}

/**
 * 根据媒体类型获取接受的文件格式
 */
export function getAcceptFormats(mediaType: MediaType): string[] {
  switch (mediaType) {
    case '视频':
      return ['video/*'];
    case '图片':
      return ['image/*'];
    case '提示词':
      return ['text/*', '.txt', '.md'];
    case '声音':
      return ['audio/*', '.mp3', '.wav', '.flac', '.aac', '.ogg'];
  }
}

/**
 * 判断媒体类型是否为文本（提示词）
 */
export function isTextSection(mediaType: MediaType): boolean {
  return mediaType === '提示词';
}

/**
 * 从 MIME 类型推断媒体类型
 */
export function getMediaTypeFromMime(mimeType: string): MediaType | null {
  if (mimeType.startsWith('video/')) return '视频';
  if (mimeType.startsWith('image/')) return '图片';
  if (mimeType.startsWith('text/')) return '提示词';
  if (mimeType.startsWith('audio/')) return '声音';
  return null;
}
