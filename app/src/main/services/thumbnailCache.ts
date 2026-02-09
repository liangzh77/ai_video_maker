/**
 * 缩略图和元数据持久化缓存服务
 *
 * 使用文件指纹（大小 + 文件头哈希）作为缓存 key，
 * 这样文件重命名后缓存仍然有效。
 *
 * 缓存结构：
 * thumbnails/
 * ├── index.json           # 缓存索引
 * ├── {fingerprint}.jpg    # 缩略图
 * └── {fingerprint}.json   # 元数据
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ResourceMetadata } from '@shared/types';
import { getFFmpegPath } from './python-bridge';

const execAsync = promisify(exec);

// 缩略图尺寸（宽度，高度按比例缩放）
const THUMBNAIL_WIDTH = 200;

// 读取文件头的大小（用于计算快速哈希）
const HASH_CHUNK_SIZE = 64 * 1024; // 64KB

// 缓存索引条目
interface CacheIndexEntry {
  fingerprint: string;      // 文件指纹
  size: number;             // 文件大小（用于快速验证）
  hasThumbnail: boolean;    // 是否有缩略图
  hasMetadata: boolean;     // 是否有元数据
  createdAt: string;        // 缓存创建时间
}

// 缓存索引（指纹 -> 条目）
interface CacheIndex {
  version: number;
  entries: Record<string, CacheIndexEntry>;
}

const CACHE_VERSION = 1;

// 内存中的索引缓存（draftId -> CacheIndex）
const indexCache = new Map<string, CacheIndex>();

/**
 * 获取缩略图目录路径
 */
function getThumbnailsPath(draftPath: string): string {
  return path.join(draftPath, 'thumbnails');
}

/**
 * 获取缓存索引文件路径
 */
function getIndexPath(draftPath: string): string {
  return path.join(getThumbnailsPath(draftPath), 'index.json');
}

/**
 * 计算文件指纹（大小 + 文件头哈希）
 * 快速且唯一：只读取文件头 64KB
 */
export async function computeFingerprint(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const size = stat.size;

    // 读取文件头
    const fd = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(HASH_CHUNK_SIZE, size));
    await fd.read(buffer, 0, buffer.length, 0);
    await fd.close();

    // 计算哈希：大小 + 文件头内容
    const hash = crypto.createHash('md5');
    hash.update(size.toString());
    hash.update(buffer);

    return hash.digest('hex').substring(0, 16); // 取前16位，足够唯一
  } catch (err) {
    console.error('[ThumbnailCache] Failed to compute fingerprint:', filePath, err);
    throw err;
  }
}

/**
 * 加载缓存索引
 */
async function loadIndex(draftPath: string): Promise<CacheIndex> {
  // 先检查内存缓存
  const cached = indexCache.get(draftPath);
  if (cached) {
    return cached;
  }

  const indexPath = getIndexPath(draftPath);

  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    const index: CacheIndex = JSON.parse(content);

    // 版本检查
    if (index.version !== CACHE_VERSION) {
      console.log('[ThumbnailCache] Cache version mismatch, creating new index');
      const newIndex: CacheIndex = { version: CACHE_VERSION, entries: {} };
      indexCache.set(draftPath, newIndex);
      return newIndex;
    }

    indexCache.set(draftPath, index);
    return index;
  } catch {
    // 文件不存在或解析失败，创建新索引
    const newIndex: CacheIndex = { version: CACHE_VERSION, entries: {} };
    indexCache.set(draftPath, newIndex);
    return newIndex;
  }
}

/**
 * 保存缓存索引
 */
async function saveIndex(draftPath: string, index: CacheIndex): Promise<void> {
  const thumbnailsPath = getThumbnailsPath(draftPath);
  const indexPath = getIndexPath(draftPath);

  try {
    await fs.mkdir(thumbnailsPath, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    indexCache.set(draftPath, index);
  } catch (err) {
    console.error('[ThumbnailCache] Failed to save index:', err);
  }
}

/**
 * 获取缓存的元数据
 */
export async function getMetadata(
  draftPath: string,
  filePath: string
): Promise<ResourceMetadata | null> {
  try {
    const fingerprint = await computeFingerprint(filePath);
    const index = await loadIndex(draftPath);
    const entry = index.entries[fingerprint];

    if (!entry || !entry.hasMetadata) {
      return null;
    }

    // 验证文件大小
    const stat = await fs.stat(filePath);
    if (stat.size !== entry.size) {
      // 文件已修改，缓存失效
      return null;
    }

    // 读取元数据文件
    const metadataPath = path.join(getThumbnailsPath(draftPath), `${fingerprint}.json`);
    const content = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(content) as ResourceMetadata;
  } catch {
    return null;
  }
}

/**
 * 保存元数据到缓存
 */
export async function saveMetadata(
  draftPath: string,
  filePath: string,
  metadata: ResourceMetadata
): Promise<void> {
  try {
    const fingerprint = await computeFingerprint(filePath);
    const stat = await fs.stat(filePath);
    const index = await loadIndex(draftPath);

    // 更新索引
    const entry = index.entries[fingerprint] || {
      fingerprint,
      size: stat.size,
      hasThumbnail: false,
      hasMetadata: false,
      createdAt: new Date().toISOString(),
    };
    entry.hasMetadata = true;
    entry.size = stat.size;
    index.entries[fingerprint] = entry;

    // 保存元数据文件
    const thumbnailsPath = getThumbnailsPath(draftPath);
    await fs.mkdir(thumbnailsPath, { recursive: true });
    const metadataPath = path.join(thumbnailsPath, `${fingerprint}.json`);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // 保存索引
    await saveIndex(draftPath, index);
  } catch (err) {
    console.error('[ThumbnailCache] Failed to save metadata:', err);
  }
}

/**
 * 获取缓存的缩略图路径
 */
export async function getThumbnailPath(
  draftPath: string,
  filePath: string
): Promise<string | null> {
  try {
    const fingerprint = await computeFingerprint(filePath);
    const index = await loadIndex(draftPath);
    const entry = index.entries[fingerprint];

    if (!entry || !entry.hasThumbnail) {
      return null;
    }

    // 验证文件大小
    const stat = await fs.stat(filePath);
    if (stat.size !== entry.size) {
      return null;
    }

    const thumbnailPath = path.join(getThumbnailsPath(draftPath), `${fingerprint}.jpg`);

    // 验证缩略图文件存在
    try {
      await fs.access(thumbnailPath);
      return thumbnailPath;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * 保存缩略图到缓存
 */
export async function saveThumbnail(
  draftPath: string,
  filePath: string,
  imageBuffer: Buffer
): Promise<string> {
  const fingerprint = await computeFingerprint(filePath);
  const stat = await fs.stat(filePath);
  const index = await loadIndex(draftPath);

  // 更新索引
  const entry = index.entries[fingerprint] || {
    fingerprint,
    size: stat.size,
    hasThumbnail: false,
    hasMetadata: false,
    createdAt: new Date().toISOString(),
  };
  entry.hasThumbnail = true;
  entry.size = stat.size;
  index.entries[fingerprint] = entry;

  // 保存缩略图文件
  const thumbnailsPath = getThumbnailsPath(draftPath);
  await fs.mkdir(thumbnailsPath, { recursive: true });
  const thumbnailPath = path.join(thumbnailsPath, `${fingerprint}.jpg`);
  await fs.writeFile(thumbnailPath, imageBuffer);

  // 保存索引
  await saveIndex(draftPath, index);

  return thumbnailPath;
}

/**
 * 清理指定草稿的缓存索引内存
 */
export function clearIndexCache(draftPath: string): void {
  indexCache.delete(draftPath);
}

/**
 * 清理所有内存中的索引缓存
 */
export function clearAllIndexCache(): void {
  indexCache.clear();
}

/**
 * 清理孤立的缓存文件（可选的维护操作）
 * 删除索引中不存在的缓存文件
 */
export async function cleanupOrphanedCache(draftPath: string): Promise<number> {
  const thumbnailsPath = getThumbnailsPath(draftPath);
  const index = await loadIndex(draftPath);
  let deletedCount = 0;

  try {
    const entries = await fs.readdir(thumbnailsPath, { withFileTypes: true });
    const validFingerprints = new Set(Object.keys(index.entries));

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === 'index.json') continue;

      // 提取指纹（文件名去掉扩展名）
      const fingerprint = path.parse(entry.name).name;

      if (!validFingerprints.has(fingerprint)) {
        // 孤立文件，删除
        try {
          await fs.unlink(path.join(thumbnailsPath, entry.name));
          deletedCount++;
        } catch {
          // 忽略删除失败
        }
      }
    }
  } catch {
    // 目录可能不存在
  }

  return deletedCount;
}

// ============================================
// Thumbnail Generation
// ============================================

/**
 * 生成视频缩略图（截取第一帧）
 * @param videoPath 视频文件路径
 * @param outputPath 输出缩略图路径
 */
async function generateVideoThumbnail(videoPath: string, outputPath: string): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  // 截取 0.1 秒处的帧，缩放到指定宽度，保持宽高比
  const cmd = `"${ffmpegPath}" -y -ss 0.1 -i "${videoPath}" -frames:v 1 -vf "scale=${THUMBNAIL_WIDTH}:-1" -q:v 2 "${outputPath}"`;
  await execAsync(cmd, { encoding: 'utf-8' });
}

/**
 * 生成图片缩略图（缩小尺寸）
 * @param imagePath 图片文件路径
 * @param outputPath 输出缩略图路径
 */
async function generateImageThumbnail(imagePath: string, outputPath: string): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  // 缩放到指定宽度，保持宽高比
  const cmd = `"${ffmpegPath}" -y -i "${imagePath}" -vf "scale=${THUMBNAIL_WIDTH}:-1" -q:v 2 "${outputPath}"`;
  await execAsync(cmd, { encoding: 'utf-8' });
}

/**
 * 获取或生成缩略图
 * 如果缓存中存在则直接返回，否则生成新的缩略图
 *
 * @param draftPath 草稿路径
 * @param filePath 原文件路径
 * @param mediaType 媒体类型 ('video' | 'image')
 * @returns 缩略图文件路径，如果生成失败则返回 null
 */
export async function getOrGenerateThumbnail(
  draftPath: string,
  filePath: string,
  mediaType: 'video' | 'image'
): Promise<string | null> {
  try {
    // 1. 先检查缓存
    const cachedPath = await getThumbnailPath(draftPath, filePath);
    if (cachedPath) {
      return cachedPath;
    }

    // 2. 缓存不存在，生成新的缩略图
    const fingerprint = await computeFingerprint(filePath);
    const thumbnailsPath = getThumbnailsPath(draftPath);
    await fs.mkdir(thumbnailsPath, { recursive: true });

    const tempPath = path.join(thumbnailsPath, `${fingerprint}_temp.jpg`);
    const finalPath = path.join(thumbnailsPath, `${fingerprint}.jpg`);

    try {
      // 生成缩略图到临时文件
      if (mediaType === 'video') {
        await generateVideoThumbnail(filePath, tempPath);
      } else {
        await generateImageThumbnail(filePath, tempPath);
      }

      // 读取生成的缩略图
      const imageBuffer = await fs.readFile(tempPath);

      // 保存到缓存（会更新索引）
      await saveThumbnail(draftPath, filePath, imageBuffer);

      // 删除临时文件（saveThumbnail 已经创建了最终文件）
      try {
        await fs.unlink(tempPath);
      } catch {
        // 忽略删除失败
      }

      return finalPath;
    } catch (err) {
      console.error('[ThumbnailCache] Failed to generate thumbnail:', filePath, err);
      // 清理临时文件
      try {
        await fs.unlink(tempPath);
      } catch {
        // 忽略
      }
      return null;
    }
  } catch (err) {
    console.error('[ThumbnailCache] getOrGenerateThumbnail error:', err);
    return null;
  }
}

export default {
  computeFingerprint,
  getMetadata,
  saveMetadata,
  getThumbnailPath,
  saveThumbnail,
  getOrGenerateThumbnail,
  clearIndexCache,
  clearAllIndexCache,
  cleanupOrphanedCache,
};
