/**
 * 数据迁移模块
 *
 * 用于将旧版草稿数据迁移到新格式：
 * - 资源 ID 从 UUID 改为相对路径
 * - 删除 resources.json（资源列表现在通过扫描文件系统获取）
 * - 重命名文件夹：原角色图片 -> 源角色图片
 * - 更新 links.json 中的 UUID 为相对路径
 * - 更新 分割点.txt 中的 UUID 为相对路径
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Resource } from '@shared/types';

// 旧的 resources.json 结构
interface OldResourcesFile {
  resources: Resource[];
}

// 旧的 links.json 结构
interface OldLinksFile {
  sourceToNew: Record<string, string>;
}

// 旧的分割点文件结构
interface OldSplitPointsFile {
  videoId: string;
  duration: number;
  fps: number;
  splitPoints: Array<{
    id: string;
    time: number;
    frame: number;
    isAutoDetected: boolean;
  }>;
  savedAt: string;
}

/**
 * 检查草稿是否需要迁移
 */
export async function needsMigration(draftPath: string): Promise<boolean> {
  const resourcesPath = path.join(draftPath, 'resources.json');
  try {
    await fs.access(resourcesPath);
    return true; // resources.json 存在，需要迁移
  } catch {
    return false; // resources.json 不存在，不需要迁移
  }
}

/**
 * 迁移草稿数据
 */
export async function migrateDraft(draftPath: string): Promise<void> {
  console.log('[Migration] Starting migration for:', draftPath);

  const resourcesPath = path.join(draftPath, 'resources.json');
  const linksPath = path.join(draftPath, 'links.json');
  const filesPath = path.join(draftPath, 'files');
  const splitPointsPath = path.join(filesPath, '分割点.txt');

  // 1. 读取 resources.json 构建 UUID -> 相对路径 映射
  const uuidToRelativePath = new Map<string, string>();

  try {
    const content = await fs.readFile(resourcesPath, 'utf-8');
    const data: OldResourcesFile = JSON.parse(content);

    for (const resource of data.resources) {
      // 从 filePath 提取相对路径
      const relativePath = path.relative(filesPath, resource.filePath).replace(/\\/g, '/');
      uuidToRelativePath.set(resource.id, relativePath);
      console.log(`[Migration] Mapped: ${resource.id} -> ${relativePath}`);
    }
  } catch (err) {
    console.error('[Migration] Failed to read resources.json:', err);
    return;
  }

  // 2. 更新 links.json
  try {
    const content = await fs.readFile(linksPath, 'utf-8');
    const links: OldLinksFile = JSON.parse(content);

    // 转换 sourceToNew 中的 UUID 为相对路径
    const newSourceToNew: Record<string, string> = {};
    for (const [sourceId, newId] of Object.entries(links.sourceToNew)) {
      const sourceRelPath = uuidToRelativePath.get(sourceId);
      const newRelPath = uuidToRelativePath.get(newId);

      if (sourceRelPath && newRelPath) {
        newSourceToNew[sourceRelPath] = newRelPath;
        console.log(`[Migration] Link: ${sourceRelPath} -> ${newRelPath}`);
      }
    }

    // 写回 links.json
    const newLinks: OldLinksFile = { sourceToNew: newSourceToNew };
    await fs.writeFile(linksPath, JSON.stringify(newLinks, null, 2), 'utf-8');
    console.log('[Migration] Updated links.json');
  } catch (err) {
    console.log('[Migration] No links.json to update or error:', err);
  }

  // 3. 更新分割点.txt
  try {
    const content = await fs.readFile(splitPointsPath, 'utf-8');
    const splitPoints: OldSplitPointsFile = JSON.parse(content);

    // 更新 videoId
    const videoRelPath = uuidToRelativePath.get(splitPoints.videoId);
    if (videoRelPath) {
      splitPoints.videoId = videoRelPath;
      await fs.writeFile(splitPointsPath, JSON.stringify(splitPoints, null, 2), 'utf-8');
      console.log('[Migration] Updated 分割点.txt videoId:', videoRelPath);
    }
  } catch (err) {
    console.log('[Migration] No split points to update or error:', err);
  }

  // 4. 重命名文件夹：原角色图片 -> 源角色图片
  const oldCharacterPath = path.join(filesPath, '原角色图片');
  const newCharacterPath = path.join(filesPath, '源角色图片');
  try {
    await fs.access(oldCharacterPath);
    await fs.rename(oldCharacterPath, newCharacterPath);
    console.log('[Migration] Renamed 原角色图片 -> 源角色图片');
  } catch {
    // 文件夹可能不存在或已经重命名
  }

  // 5. 删除 resources.json
  try {
    await fs.unlink(resourcesPath);
    console.log('[Migration] Deleted resources.json');
  } catch (err) {
    console.error('[Migration] Failed to delete resources.json:', err);
  }

  console.log('[Migration] Migration completed for:', draftPath);
}

/**
 * 检查并迁移草稿（用于 selectDraft 时调用）
 */
export async function checkAndMigrate(draftPath: string): Promise<void> {
  if (await needsMigration(draftPath)) {
    console.log('[Migration] Draft needs migration:', draftPath);
    await migrateDraft(draftPath);
  }
}

export default {
  needsMigration,
  migrateDraft,
  checkAndMigrate,
};
