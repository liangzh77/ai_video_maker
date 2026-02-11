/**
 * 数据迁移模块
 *
 * 用于将旧版草稿数据迁移到新格式：
 * - 资源 ID 从 UUID 改为相对路径
 * - 删除 resources.json（资源列表现在通过扫描文件系统获取）
 * - 重命名文件夹：原角色图片 -> 源角色图片
 * - 移动并更新 links.json（从草稿根目录移到 files/关联.json）
 * - 更新 分割点.txt 中的 UUID 为相对路径
 * - 将旧中文文件夹名迁移为 {序号}_{媒体类型}_{名称} 格式
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Resource, MediaType } from '@shared/types';
import { parseFolderName, buildFolderName } from '@shared/section-utils';

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
  const oldLinksPath = path.join(draftPath, 'links.json'); // 旧位置
  const filesPath = path.join(draftPath, 'files');
  const newLinksPath = path.join(filesPath, '关联.json'); // 新位置
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

  // 2. 更新并移动 links.json（从草稿根目录移到 files/关联.json）
  try {
    const content = await fs.readFile(oldLinksPath, 'utf-8');
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

    // 写入新位置 files/关联.json
    const newLinks: OldLinksFile = { sourceToNew: newSourceToNew };
    await fs.writeFile(newLinksPath, JSON.stringify(newLinks, null, 2), 'utf-8');
    console.log('[Migration] Created new links file:', newLinksPath);

    // 删除旧的 links.json
    await fs.unlink(oldLinksPath);
    console.log('[Migration] Deleted old links.json');
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
 * 检查是否需要移动 links.json（旧位置存在但新位置不存在）
 */
export async function needsLinksMigration(draftPath: string): Promise<boolean> {
  const oldLinksPath = path.join(draftPath, 'links.json');
  const filesPath = path.join(draftPath, 'files');
  const newLinksPath = path.join(filesPath, '关联.json');

  try {
    await fs.access(oldLinksPath);
    // 旧位置存在，检查新位置是否也存在
    try {
      await fs.access(newLinksPath);
      return false; // 新位置也存在，不需要迁移（可能是异常情况）
    } catch {
      return true; // 新位置不存在，需要迁移
    }
  } catch {
    return false; // 旧位置不存在，不需要迁移
  }
}

/**
 * 移动 links.json 到新位置（不涉及 UUID 转换）
 */
export async function migrateLinksLocation(draftPath: string): Promise<void> {
  const oldLinksPath = path.join(draftPath, 'links.json');
  const filesPath = path.join(draftPath, 'files');
  const newLinksPath = path.join(filesPath, '关联.json');

  try {
    // 确保 files 目录存在
    await fs.mkdir(filesPath, { recursive: true });

    // 读取旧文件
    const content = await fs.readFile(oldLinksPath, 'utf-8');

    // 写入新位置
    await fs.writeFile(newLinksPath, content, 'utf-8');
    console.log('[Migration] Moved links.json to:', newLinksPath);

    // 删除旧文件
    await fs.unlink(oldLinksPath);
    console.log('[Migration] Deleted old links.json');
  } catch (err) {
    console.error('[Migration] Failed to move links.json:', err);
  }
}

// =============================================
// Section 迁移：旧中文文件夹名 → {序号}_{媒体类型}_{名称}
// =============================================

/** 旧文件夹/文件名 → 新 section 信息映射 */
const OLD_FOLDER_MIGRATION: Array<{
  oldName: string;
  isFolder: boolean;
  order: number;
  mediaType: MediaType;
  label: string;
}> = [
  { oldName: '源视频', isFolder: false, order: 1, mediaType: '视频', label: '源视频' },
  { oldName: '源角色图片', isFolder: true, order: 2, mediaType: '图片', label: '源角色图片' },
  { oldName: '提示词', isFolder: true, order: 3, mediaType: '提示词', label: '提示词' },
  { oldName: '新角色图片', isFolder: true, order: 4, mediaType: '图片', label: '新角色图片' },
  { oldName: '分镜源视频', isFolder: true, order: 5, mediaType: '视频', label: '分镜源视频' },
  { oldName: '分镜新视频', isFolder: true, order: 6, mediaType: '视频', label: '分镜新视频' },
  { oldName: '高清分镜新视频', isFolder: true, order: 7, mediaType: '视频', label: '高清分镜新视频' },
  { oldName: '对口型新视频', isFolder: true, order: 8, mediaType: '视频', label: '对口型新视频' },
  { oldName: '合成新视频', isFolder: true, order: 9, mediaType: '视频', label: '合成新视频' },
];

/**
 * 检查草稿是否需要 section 文件夹迁移
 * 条件：files/ 下存在旧中文文件夹名，且没有新格式的文件夹
 */
export async function needsSectionMigration(draftPath: string): Promise<boolean> {
  const filesPath = path.join(draftPath, 'files');
  try {
    const entries = await fs.readdir(filesPath, { withFileTypes: true });
    const names = entries.map(e => e.name);

    // 检查是否有旧格式的文件夹/文件
    const hasOldFormat = OLD_FOLDER_MIGRATION.some(m => {
      if (m.isFolder) {
        return names.includes(m.oldName);
      } else {
        // 对于单文件（如 源视频），检查是否有以该名称开头的文件
        return names.some(n => n.startsWith(m.oldName + '.'));
      }
    });

    // 检查是否已经有新格式的文件夹
    const hasNewFormat = names.some(n => parseFolderName(n) !== null);

    // 有旧格式且没有新格式 → 需要迁移
    return hasOldFormat && !hasNewFormat;
  } catch {
    return false;
  }
}

/**
 * 将旧中文文件夹名迁移为 {序号}_{媒体类型}_{名称} 格式
 */
export async function migrateToSections(draftPath: string): Promise<void> {
  console.log('[Migration] Starting section migration for:', draftPath);

  const filesPath = path.join(draftPath, 'files');
  const linksPath = path.join(filesPath, '关联.json');
  const splitPointsPath = path.join(filesPath, '分割点.txt');
  const tasksPath = path.join(filesPath, 'tasks.json');

  // 构建路径映射表（旧路径前缀 → 新路径前缀）
  const pathMapping = new Map<string, string>();

  for (const migration of OLD_FOLDER_MIGRATION) {
    const newFolderName = buildFolderName(migration.order, migration.mediaType, migration.label);
    const newFolderPath = path.join(filesPath, newFolderName);

    if (migration.isFolder) {
      // 文件夹重命名
      const oldFolderPath = path.join(filesPath, migration.oldName);
      try {
        await fs.access(oldFolderPath);
        await fs.rename(oldFolderPath, newFolderPath);
        console.log(`[Migration] Renamed folder: ${migration.oldName} → ${newFolderName}`);
        // 映射：分镜源视频/xxx → 5_视频_分镜源视频/xxx
        pathMapping.set(migration.oldName + '/', newFolderName + '/');
      } catch {
        // 文件夹不存在，跳过
      }
    } else {
      // 单文件（源视频）→ 移入新文件夹
      try {
        const entries = await fs.readdir(filesPath);
        const matchingFile = entries.find(e => e.startsWith(migration.oldName + '.'));
        if (matchingFile) {
          await fs.mkdir(newFolderPath, { recursive: true });
          const ext = path.extname(matchingFile);
          const oldFilePath = path.join(filesPath, matchingFile);
          const newFilePath = path.join(newFolderPath, `001${ext}`);
          await fs.rename(oldFilePath, newFilePath);
          console.log(`[Migration] Moved file: ${matchingFile} → ${newFolderName}/001${ext}`);
          // 映射：源视频.mp4 → 1_视频_源视频/001.mp4
          pathMapping.set(matchingFile, `${newFolderName}/001${ext}`);
        }
      } catch {
        // 文件不存在，跳过
      }
    }
  }

  if (pathMapping.size === 0) {
    console.log('[Migration] No folders to migrate');
    return;
  }

  // 更新 关联.json 中的路径
  try {
    const content = await fs.readFile(linksPath, 'utf-8');
    const links: OldLinksFile = JSON.parse(content);
    const newSourceToNew: Record<string, string> = {};
    let changed = false;

    for (const [sourceId, newId] of Object.entries(links.sourceToNew)) {
      const newSourceId = replacePath(sourceId, pathMapping);
      const newNewId = replacePath(newId, pathMapping);
      newSourceToNew[newSourceId] = newNewId;
      if (newSourceId !== sourceId || newNewId !== newId) changed = true;
    }

    if (changed) {
      await fs.writeFile(linksPath, JSON.stringify({ sourceToNew: newSourceToNew }, null, 2), 'utf-8');
      console.log('[Migration] Updated 关联.json paths');
    }
  } catch {
    // 文件不存在或读取失败，跳过
  }

  // 更新 分割点.txt 中的路径
  try {
    const content = await fs.readFile(splitPointsPath, 'utf-8');
    const splitPoints: OldSplitPointsFile = JSON.parse(content);
    const newVideoId = replacePath(splitPoints.videoId, pathMapping);
    if (newVideoId !== splitPoints.videoId) {
      splitPoints.videoId = newVideoId;
      await fs.writeFile(splitPointsPath, JSON.stringify(splitPoints, null, 2), 'utf-8');
      console.log('[Migration] Updated 分割点.txt videoId:', newVideoId);
    }
  } catch {
    // 文件不存在或读取失败，跳过
  }

  // 更新 tasks.json 中的路径
  try {
    const content = await fs.readFile(tasksPath, 'utf-8');
    const tasks = JSON.parse(content);
    let changed = false;

    if (Array.isArray(tasks)) {
      for (const task of tasks) {
        if (Array.isArray(task.inputResourceIds)) {
          task.inputResourceIds = task.inputResourceIds.map((id: string) => {
            const newId = replacePath(id, pathMapping);
            if (newId !== id) changed = true;
            return newId;
          });
        }
        if (Array.isArray(task.outputResourceIds)) {
          task.outputResourceIds = task.outputResourceIds.map((id: string) => {
            const newId = replacePath(id, pathMapping);
            if (newId !== id) changed = true;
            return newId;
          });
        }
      }
    }

    if (changed) {
      await fs.writeFile(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
      console.log('[Migration] Updated tasks.json paths');
    }
  } catch {
    // 文件不存在或读取失败，跳过
  }

  console.log('[Migration] Section migration completed for:', draftPath);
}

/** 替换路径中的旧前缀为新前缀 */
function replacePath(oldPath: string, mapping: Map<string, string>): string {
  for (const [oldPrefix, newPrefix] of mapping) {
    if (oldPath === oldPrefix || oldPath.startsWith(oldPrefix)) {
      return newPrefix + oldPath.slice(oldPrefix.length);
    }
  }
  return oldPath;
}

/**
 * 检查并迁移草稿（用于 selectDraft 时调用）
 */
export async function checkAndMigrate(draftPath: string): Promise<void> {
  // 首先检查是否需要完整迁移（有 resources.json）
  if (await needsMigration(draftPath)) {
    console.log('[Migration] Draft needs full migration:', draftPath);
    await migrateDraft(draftPath);
    // 完整迁移后还需要检查 section 迁移
  }

  // 然后检查是否只需要移动 links.json
  if (await needsLinksMigration(draftPath)) {
    console.log('[Migration] Draft needs links.json move:', draftPath);
    await migrateLinksLocation(draftPath);
  }

  // 最后检查是否需要 section 文件夹迁移
  if (await needsSectionMigration(draftPath)) {
    console.log('[Migration] Draft needs section folder migration:', draftPath);
    await migrateToSections(draftPath);
  }
}

export default {
  needsMigration,
  needsLinksMigration,
  needsSectionMigration,
  migrateDraft,
  migrateLinksLocation,
  migrateToSections,
  checkAndMigrate,
};
