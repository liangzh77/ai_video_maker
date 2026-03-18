import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Draft, Resource, ResourceType, ProcessingTask, ResourceMetadata, SectionDescriptor, MediaType, ResourceMetadataFile } from '@shared/types';
import { parseFolderName, buildFolderName } from '@shared/section-utils';
import { loadConfig, saveConfig } from './config';
import { extractMetadata, getMimeType } from './metadata';
import { clearIndexCache as clearThumbnailIndexCache } from './thumbnailCache';

// ============================================
// Storage Paths
// ============================================

/** 当前工作目录路径（运行时缓存） */
let currentStorageRoot: string | null = null;

/** 获取默认工作目录路径 */
export function getDefaultStorageRoot(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'storage');
  }
  return path.join(process.cwd(), 'storage');
}

/** 获取当前工作目录路径 */
function getStorageRoot(): string {
  if (currentStorageRoot) {
    return currentStorageRoot;
  }
  return getDefaultStorageRoot();
}

/** 设置工作目录路径（运行时修改） */
export async function setStorageRoot(newPath: string): Promise<void> {
  // 确保目录存在
  await fs.mkdir(newPath, { recursive: true });
  currentStorageRoot = newPath;
  console.log('[Storage] Storage root changed to:', newPath);
}

/** 从配置加载工作目录 */
export async function loadStorageRootFromConfig(): Promise<void> {
  try {
    const config = await loadConfig();
    if (config.workspacePath) {
      // 验证路径是否存在
      try {
        await fs.access(config.workspacePath);
        currentStorageRoot = config.workspacePath;
        console.log('[Storage] Loaded storage root from config:', currentStorageRoot);
      } catch {
        // 路径不存在，使用默认值
        console.warn('[Storage] Configured workspace path does not exist, using default');
        currentStorageRoot = getDefaultStorageRoot();
      }
    }
  } catch (err) {
    console.warn('[Storage] Failed to load config, using default storage root:', err);
  }
}

/** 保存工作目录到配置 */
export async function saveStorageRootToConfig(newPath: string): Promise<void> {
  const config = await loadConfig();
  config.workspacePath = newPath;
  await saveConfig(config);
  await setStorageRoot(newPath);
}

// ============================================
// Folder Name Utilities
// ============================================

/**
 * 清理文件夹名中的非法字符（Windows）
 * @param name 原始名字
 * @returns 清理后的文件夹名
 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')  // 替换非法字符
    .replace(/\s+/g, ' ')            // 合并连续空格
    .trim()
    .substring(0, 200);              // 限制长度
}

/**
 * 检查目录是否存在
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 生成唯一的文件夹名（处理重名）
 * @param baseName 基础名字
 * @param excludeId 排除的 ID（用于重命名时跳过自己）
 * @returns 唯一的文件夹名
 */
async function getUniqueFolderName(baseName: string, excludeId?: string): Promise<string> {
  const sanitized = sanitizeFolderName(baseName);
  if (!sanitized) {
    // 如果名字清理后为空，使用默认名
    return getUniqueFolderName('未命名草稿', excludeId);
  }

  const storageRoot = getStorageRoot();

  let folderName = sanitized;
  let counter = 1;

  while (true) {
    const folderPath = path.join(storageRoot, folderName);
    const exists = await directoryExists(folderPath);

    // 如果不存在，或者是自己（重命名场景），则可用
    if (!exists || (excludeId && folderName === excludeId)) {
      break;
    }

    folderName = `${sanitized} (${counter})`;
    counter++;
  }

  return folderName;
}

function getDraftPath(draftId: string): string {
  return path.join(getStorageRoot(), draftId);
}

function getMetaPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'meta.json');
}

/**
 * @deprecated resources.json 已废弃，资源列表通过扫描文件系统获取
 * 此函数仅保留用于数据迁移
 */
function getResourcesPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'resources.json');
}

function getTasksPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'tasks.json');
}

function getLinksPath(draftId: string): string {
  return path.join(getFilesPath(draftId), '关联.json');
}

function getPromptHistoryPath(draftId: string): string {
  return path.join(getFilesPath(draftId), '提示词历史.json');
}

/**
 * @deprecated 旧版 links.json 路径，仅用于迁移
 */
function getOldLinksPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'links.json');
}

function getThumbnailsPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'thumbnails');
}

function getFilesPath(draftId: string): string {
  return path.join(getDraftPath(draftId), 'files');
}

// ============================================
// Resource File Naming Convention
// ============================================

// ============================================
// Section 管理（动态卡片栏）
// ============================================

/**
 * 扫描草稿的 files/ 目录，获取所有 section（文件夹名符合 {序号}_{媒体类型}_{名称}）
 */
export async function scanSections(draftId: string): Promise<SectionDescriptor[]> {
  const filesDir = getFilesPath(draftId);

  try {
    await fs.access(filesDir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(filesDir, { withFileTypes: true });
  const sections: SectionDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const descriptor = parseFolderName(entry.name);
    if (descriptor) {
      sections.push(descriptor);
    }
  }

  // 按序号排序
  sections.sort((a, b) => a.order - b.order);
  return sections;
}

/**
 * 创建新 section
 * 自动分配序号 = 当前最大序号 + 1
 */
export async function createSection(draftId: string, mediaType: MediaType, label: string): Promise<SectionDescriptor> {
  const filesDir = getFilesPath(draftId);
  const existing = await scanSections(draftId);

  const maxOrder = existing.length > 0 ? Math.max(...existing.map(s => s.order)) : 0;
  const newOrder = maxOrder + 1;
  const folderName = buildFolderName(newOrder, mediaType, label);

  await fs.mkdir(path.join(filesDir, folderName), { recursive: true });

  return {
    id: folderName,
    order: newOrder,
    mediaType,
    label,
  };
}

/**
 * 按 label 和 mediaType 查找已有 section，找不到则自动创建
 * 用于任务处理时的 fallback（无 targetSectionId 时）
 */
export async function findOrCreateSection(draftId: string, mediaType: MediaType, label: string): Promise<SectionDescriptor> {
  const existing = await scanSections(draftId);
  // 按 label 和 mediaType 匹配
  const found = existing.find(s => s.label === label && s.mediaType === mediaType);
  if (found) return found;
  // 未找到，创建新 section
  return createSection(draftId, mediaType, label);
}

/**
 * 删除 section（删除文件夹及其所有内容）
 */
export async function deleteSection(draftId: string, sectionId: string): Promise<void> {
  const filesDir = getFilesPath(draftId);
  const folderPath = path.join(filesDir, sectionId);
  await fs.rm(folderPath, { recursive: true, force: true });
}

/**
 * 重命名 section（文件夹跟着改名）
 */
export async function renameSection(draftId: string, sectionId: string, newLabel: string): Promise<SectionDescriptor> {
  const filesDir = getFilesPath(draftId);
  const descriptor = parseFolderName(sectionId);
  if (!descriptor) {
    throw new Error(`Invalid section id: ${sectionId}`);
  }

  const newFolderName = buildFolderName(descriptor.order, descriptor.mediaType, newLabel);
  if (newFolderName === sectionId) {
    return { ...descriptor, label: newLabel };
  }

  const oldPath = path.join(filesDir, sectionId);
  const newPath = path.join(filesDir, newFolderName);
  await fs.rename(oldPath, newPath);

  // 更新关联.json 中的资源路径引用
  await updateLinksOnSectionRename(draftId, sectionId, newFolderName);

  return {
    id: newFolderName,
    order: descriptor.order,
    mediaType: descriptor.mediaType,
    label: newLabel,
  };
}

/**
 * 重排序 sections（两步重命名法避免冲突）
 * @param orderedIds 按新顺序排列的 section ID 数组
 */
export async function reorderSections(draftId: string, orderedIds: string[]): Promise<SectionDescriptor[]> {
  const filesDir = getFilesPath(draftId);

  // 第一步：所有文件夹重命名为临时名
  const tempMappings: Array<{ oldId: string; tempName: string; descriptor: SectionDescriptor }> = [];

  for (const sectionId of orderedIds) {
    const descriptor = parseFolderName(sectionId);
    if (!descriptor) continue;

    const tempName = `_temp_reorder_${descriptor.order}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const oldPath = path.join(filesDir, sectionId);
    const tempPath = path.join(filesDir, tempName);

    try {
      await fs.rename(oldPath, tempPath);
      tempMappings.push({ oldId: sectionId, tempName, descriptor });
    } catch (err) {
      // 回滚已重命名的
      for (const item of tempMappings) {
        try {
          await fs.rename(
            path.join(filesDir, item.tempName),
            path.join(filesDir, item.oldId)
          );
        } catch {}
      }
      throw err;
    }
  }

  // 第二步：按新顺序重命名为最终名
  const newSections: SectionDescriptor[] = [];
  const oldToNewMap = new Map<string, string>();

  for (let i = 0; i < tempMappings.length; i++) {
    const { oldId, tempName, descriptor } = tempMappings[i];
    const newOrder = i + 1;
    const newFolderName = buildFolderName(newOrder, descriptor.mediaType, descriptor.label);

    const tempPath = path.join(filesDir, tempName);
    const newPath = path.join(filesDir, newFolderName);
    await fs.rename(tempPath, newPath);

    oldToNewMap.set(oldId, newFolderName);
    newSections.push({
      id: newFolderName,
      order: newOrder,
      mediaType: descriptor.mediaType,
      label: descriptor.label,
    });
  }

  // 更新关联.json 中的路径引用
  await updateLinksOnSectionsReorder(draftId, oldToNewMap);

  return newSections;
}

/**
 * section 重命名后更新关联.json 中的资源路径
 */
async function updateLinksOnSectionRename(
  draftId: string,
  oldSectionId: string,
  newSectionId: string
): Promise<void> {
  try {
    const links = await loadLinks(draftId);
    let updated = false;
    const newSourceToNew: Record<string, string> = {};

    for (const [key, value] of Object.entries(links.sourceToNew)) {
      let newKey = key;
      let newValue = value;

      if (key.startsWith(oldSectionId + '/')) {
        newKey = newSectionId + '/' + key.substring(oldSectionId.length + 1);
        updated = true;
      }
      if (value.startsWith(oldSectionId + '/')) {
        newValue = newSectionId + '/' + value.substring(oldSectionId.length + 1);
        updated = true;
      }

      newSourceToNew[newKey] = newValue;
    }

    if (updated) {
      links.sourceToNew = newSourceToNew;
      await saveLinks(draftId, links);
    }
  } catch {}
}

/**
 * sections 重排序后批量更新关联.json 中的路径
 */
async function updateLinksOnSectionsReorder(
  draftId: string,
  oldToNewMap: Map<string, string>
): Promise<void> {
  if (oldToNewMap.size === 0) return;

  try {
    const links = await loadLinks(draftId);
    let updated = false;
    const newSourceToNew: Record<string, string> = {};

    for (const [key, value] of Object.entries(links.sourceToNew)) {
      let newKey = key;
      let newValue = value;

      for (const [oldId, newId] of oldToNewMap) {
        if (key.startsWith(oldId + '/')) {
          newKey = newId + '/' + key.substring(oldId.length + 1);
          updated = true;
        }
        if (value.startsWith(oldId + '/')) {
          newValue = newId + '/' + value.substring(oldId.length + 1);
          updated = true;
        }
      }

      newSourceToNew[newKey] = newValue;
    }

    if (updated) {
      links.sourceToNew = newSourceToNew;
      await saveLinks(draftId, links);
    }
  } catch {}
}

/**
 * 获取资源文件的目标路径
 * @param draftId 草稿ID
 * @param sectionId section 文件夹名（如 "1_视频_源视频"）
 * @param ext 文件扩展名（包含点号，如 ".mp4"）
 * @param sequenceNumber 序号（用于文件夹内多个文件的情况）
 */
export function getResourceFilePath(
  draftId: string,
  sectionId: string,
  ext: string,
  sequenceNumber?: number
): string {
  const filesDir = getFilesPath(draftId);
  const folderPath = path.join(filesDir, sectionId);
  const fileName = sequenceNumber !== undefined
    ? `${sequenceNumber.toString().padStart(3, '0')}${ext}`
    : `001${ext}`;
  return path.join(folderPath, fileName);
}

/**
 * 获取资源文件夹路径
 * @param sectionId section 文件夹名
 */
export function getResourceFolderPath(draftId: string, sectionId: string): string {
  return path.join(getFilesPath(draftId), sectionId);
}

/**
 * 从相对路径获取资源类型（即 section ID = 文件夹名）
 * 例如：'1_视频_源视频/001.mp4' -> '1_视频_源视频'
 */
export function getResourceTypeFromPath(relativePath: string): ResourceType | null {
  const parts = relativePath.split(/[/\\]/);

  if (parts.length < 2) {
    // 顶层文件不属于任何 section
    return null;
  }

  // 第一个目录名就是 section ID（如果符合命名规范）
  const folderName = parts[0];
  const descriptor = parseFolderName(folderName);
  return descriptor ? folderName : null;
}

// ============================================
// 扫描资源文件系统
// ============================================

/**
 * 扫描草稿的 files 目录获取所有资源
 * 资源 ID 为相对路径（如 '1_视频_源视频/001.mp4'）
 * 元数据使用持久化缓存（thumbnails 文件夹）
 */
export async function scanResources(draftId: string, type?: ResourceType): Promise<Resource[]> {
  const filesDir = getFilesPath(draftId);
  const resources: Resource[] = [];

  try {
    await fs.access(filesDir);
  } catch {
    return resources;
  }

  // 获取所有 section
  const sections = await scanSections(draftId);

  for (const section of sections) {
    // 如果指定了类型筛选，跳过不匹配的
    if (type && section.id !== type) {
      continue;
    }

    const folderPath = path.join(filesDir, section.id);
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });

      // 迁移旧格式伴随文件：xxx.mp4.分割点.json → xxx.json
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.分割点.json')) {
          const oldPath = path.join(folderPath, entry.name);
          // 从 "001.mp4.分割点.json" 提取 "001"
          const baseName = entry.name.replace(/\.[^.]+\.分割点\.json$/, '');
          const newPath = path.join(folderPath, baseName + '.json');
          try {
            // 读取旧文件并转换格式
            const oldData = await readJson<any>(oldPath, null);
            if (oldData) {
              const newData: any = {};
              if (oldData.splitPoints || oldData.duration || oldData.fps) {
                newData.splitPoints = {
                  duration: oldData.duration,
                  fps: oldData.fps,
                  points: oldData.splitPoints || [],
                };
              }
              if (oldData.generation) {
                newData.generation = oldData.generation;
              }
              newData.savedAt = oldData.savedAt || new Date().toISOString();
              await writeJson(newPath, newData);
              await fs.unlink(oldPath);
              console.log('[Storage] Migrated companion file:', entry.name, '->', baseName + '.json');
            }
          } catch (err) {
            console.warn('[Storage] Failed to migrate companion file:', entry.name, err);
          }
        }
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.') || entry.name.startsWith('_temp_')) continue;
        if (entry.name.endsWith('.json')) continue;

        const filePath = path.join(folderPath, entry.name);
        const relativePath = `${section.id}/${entry.name}`;

        const resource = await buildResource(
          draftId,
          relativePath,
          filePath,
          section.id,
          entry.name
        );

        if (resource) {
          resources.push(resource);
        }
      }
    } catch {
      // 文件夹不存在或读取失败，跳过
    }
  }

  // 按 section 顺序排序，同 section 内按文件名数字排序
  resources.sort((a, b) => {
    if (a.type !== b.type) {
      const orderA = parseFolderName(a.type)?.order ?? 999;
      const orderB = parseFolderName(b.type)?.order ?? 999;
      return orderA - orderB;
    }
    return a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true });
  });

  return resources;
}

/**
 * 构建单个资源对象
 * 使用持久化缓存（thumbnails 文件夹）存储元数据
 */
async function buildResource(
  draftId: string,
  relativePath: string,
  filePath: string,
  sectionId: string,
  fileName: string
): Promise<Resource | null> {
  try {
    const stat = await fs.stat(filePath);
    const draftPath = getDraftPath(draftId);

    // 提取元数据（会自动使用持久化缓存）
    const metadata = await extractMetadata(filePath, sectionId, draftPath);

    // 检查伴随 JSON 是否有 generation 字段
    let hasGenerationMeta = false;
    try {
      const companionData = await readJson<any>(getCompanionPath(filePath), null);
      if (companionData?.generation) {
        hasGenerationMeta = true;
      }
    } catch {}

    const resource: Resource = {
      id: relativePath, // 使用相对路径作为 ID
      draftId,
      type: sectionId,  // section ID 就是资源类型
      fileName,
      filePath,
      fileSize: stat.size,
      mimeType: getMimeType(filePath),
      metadata,
      createdAt: stat.birthtime.toISOString(),
      hasGenerationMeta,
    };

    return resource;
  } catch (err) {
    console.error('[Storage] Failed to build resource:', filePath, err);
    return null;
  }
}

/**
 * 获取文件夹中下一个可用的序号
 */
export async function getNextSequenceNumber(draftId: string, sectionId: string): Promise<number> {
  const folderPath = getResourceFolderPath(draftId, sectionId);

  try {
    await fs.mkdir(folderPath, { recursive: true });
    const entries = await fs.readdir(folderPath);

    // 提取现有文件的序号（支持 001.mp4 和 001_name.mp4 两种格式）
    const numbers = entries
      .map(name => {
        const match = name.match(/^(\d+)(?:_|\.)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);

    if (numbers.length === 0) {
      return 1;
    }

    return Math.max(...numbers) + 1;
  } catch {
    return 1;
  }
}

// ============================================
// 文件序号命名相关函数
// ============================================

/**
 * 从文件名中提取序号
 * 支持格式：001.mp4, 001_name.mp4
 * @returns 序号，如果没有序号则返回 0
 */
export function getSequenceFromFileName(fileName: string): number {
  const match = fileName.match(/^(\d+)(?:_|\.)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * 从文件名中提取原始文件名（去掉序号前缀）
 * 001_scene1.mp4 -> scene1
 * 001.mp4 -> (empty string)
 */
export function getOriginalNameFromFileName(fileName: string): string {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const match = baseName.match(/^\d+_(.+)$/);
  return match ? match[1] : '';
}

/**
 * 生成带序号的文件名
 * @param sequence 序号（1-999）
 * @param originalName 原始文件名（不含扩展名，可以为空）
 * @param ext 扩展名（包含点号，如 ".mp4"）
 */
export function makeSequencedFileName(sequence: number, originalName: string, ext: string): string {
  const seqStr = sequence.toString().padStart(3, '0');
  if (originalName) {
    return `${seqStr}_${originalName}${ext}`;
  }
  return `${seqStr}${ext}`;
}

/**
 * 重新排序指定类型的所有资源文件
 * 通过重命名文件来实现排序
 * @param draftId 草稿ID
 * @param resourceType 资源类型
 * @param orderedResourceIds 按新顺序排列的资源ID数组（相对路径）
 * @returns 新的资源ID列表（相对路径）
 */
export async function reorderResourceFiles(
  draftId: string,
  sectionId: string,
  orderedResourceIds: string[]
): Promise<string[]> {
  console.log('[Storage] reorderResourceFiles START:', { draftId, sectionId, orderedResourceIds });

  if (orderedResourceIds.length === 0) {
    console.log('[Storage] reorderResourceFiles: Empty list, returning');
    return [];
  }

  const folderPath = getResourceFolderPath(draftId, sectionId);
  console.log('[Storage] reorderResourceFiles: folderPath =', folderPath);

  const filesDir = getFilesPath(draftId);
  console.log('[Storage] reorderResourceFiles: filesDir =', filesDir, 'sectionId =', sectionId);

  // 第一步：将所有文件重命名为临时名称，避免冲突
  // 直接从资源 ID（相对路径）构建文件路径，不需要扫描
  const tempRenames: Array<{ oldId: string; oldPath: string; tempPath: string; originalName: string; ext: string }> = [];

  console.log('[Storage] reorderResourceFiles: Step 1 - Renaming to temp files');
  for (const resourceId of orderedResourceIds) {
    const oldPath = path.join(filesDir, resourceId);
    const fileName = path.basename(resourceId);
    const ext = path.extname(fileName);
    const tempFileName = `_temp_${uuidv4()}${ext}`;
    const tempPath = path.join(folderPath, tempFileName);
    const originalName = getOriginalNameFromFileName(fileName);

    console.log('[Storage] Step 1:', { resourceId, oldPath, tempPath, originalName });

    try {
      await fs.rename(oldPath, tempPath);
      // 同步重命名伴随 JSON 文件（忽略不存在）
      try { await fs.rename(getCompanionPath(oldPath), getCompanionPath(tempPath)); } catch {}
      try { await fs.rename(oldPath + '.分割点.json', tempPath + '.分割点.json'); } catch {} // 向后兼容
      console.log('[Storage] Step 1 SUCCESS:', oldPath, '->', tempPath);
      tempRenames.push({ oldId: resourceId, oldPath, tempPath, originalName, ext });
    } catch (err) {
      console.error('[Storage] Step 1 FAILED:', oldPath, '->', tempPath, err);
      // 回滚已重命名的文件
      console.log('[Storage] Rolling back', tempRenames.length, 'files');
      for (const item of tempRenames) {
        try {
          await fs.rename(item.tempPath, item.oldPath);
          try { await fs.rename(getCompanionPath(item.tempPath), getCompanionPath(item.oldPath)); } catch {}
          try { await fs.rename(item.tempPath + '.分割点.json', item.oldPath + '.分割点.json'); } catch {} // 向后兼容
          console.log('[Storage] Rollback SUCCESS:', item.tempPath, '->', item.oldPath);
        } catch (rollbackErr) {
          console.error('[Storage] Rollback FAILED:', item.tempPath, rollbackErr);
        }
      }
      throw err;
    }
  }

  // 第二步：按新顺序重命名为最终名称，同时构建 ID 映射
  const oldToNewIdMap = new Map<string, string>();
  const newResourceIds: string[] = [];

  console.log('[Storage] reorderResourceFiles: Step 2 - Renaming to final names');
  for (let i = 0; i < tempRenames.length; i++) {
    const { oldId, tempPath, originalName, ext } = tempRenames[i];
    const newSequence = i + 1;
    const newFileName = makeSequencedFileName(newSequence, originalName, ext);
    const newPath = path.join(folderPath, newFileName);
    const newRelativePath = `${sectionId}/${newFileName}`;

    console.log('[Storage] Step 2:', { i, tempPath, newPath, newRelativePath });

    try {
      await fs.rename(tempPath, newPath);
      // 同步重命名伴随 JSON 文件（忽略不存在）
      try { await fs.rename(getCompanionPath(tempPath), getCompanionPath(newPath)); } catch {}
      try { await fs.rename(tempPath + '.分割点.json', newPath + '.分割点.json'); } catch {} // 向后兼容
      console.log('[Storage] Step 2 SUCCESS:', tempPath, '->', newPath);
      newResourceIds.push(newRelativePath);
      oldToNewIdMap.set(oldId, newRelativePath);
    } catch (err) {
      console.error('[Storage] Step 2 FAILED:', tempPath, '->', newPath, err);
      throw err;
    }
  }

  // 第三步：如果是 scene_source 或 scene_new，更新 links.json 中的引用
  // 更新 links.json 中可能引用了这些资源的条目
  console.log('[Storage] reorderResourceFiles: Step 3 - Updating links');
  await updateLinksOnReorder(draftId, sectionId, oldToNewIdMap);

  // 注意：持久化缓存基于文件指纹（内容哈希），文件重命名不影响缓存

  console.log('[Storage] reorderResourceFiles DONE:', newResourceIds.length, 'resources of sectionId', sectionId);
  return newResourceIds;
}

/**
 * 删除资源后重新整理序号
 * @param draftId 草稿ID
 * @param resourceType 资源类型
 */
export async function renumberResourceFiles(
  draftId: string,
  sectionId: string
): Promise<void> {
  const folderPath = getResourceFolderPath(draftId, sectionId);

  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const fileNames = entries
      .filter(e => e.isFile() && !e.name.startsWith('.') && !e.name.startsWith('_temp_') && !e.name.endsWith('.json'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

    if (fileNames.length === 0) return;

    const resourceIds = fileNames.map(name => `${sectionId}/${name}`);
    await reorderResourceFiles(draftId, sectionId, resourceIds);
  } catch {
    // 文件夹可能不存在
  }
}

/**
 * 重排序后更新 links.json 中的资源引用
 * 通用处理：检查 keys 和 values 中是否有匹配的旧 ID，统一替换
 */
async function updateLinksOnReorder(
  draftId: string,
  _sectionId: string,
  oldToNewIdMap: Map<string, string>
): Promise<void> {
  if (oldToNewIdMap.size === 0) return;

  try {
    const links = await loadLinks(draftId);
    let updated = false;
    const newSourceToNew: Record<string, string> = {};

    for (const [key, value] of Object.entries(links.sourceToNew)) {
      const newKey = oldToNewIdMap.get(key) || key;
      const newValue = oldToNewIdMap.get(value) || value;
      if (newKey !== key || newValue !== value) {
        updated = true;
      }
      newSourceToNew[newKey] = newValue;
    }

    if (updated) {
      links.sourceToNew = newSourceToNew;
      await saveLinks(draftId, links);
      console.log('[Storage] Updated links.json after reorder');
    }
  } catch (err) {
    console.error('[Storage] Failed to update links on reorder:', err);
  }
}

// ============================================
// JSON Read/Write Utilities
// ============================================

async function readJson<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return defaultValue;
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================
// Storage Initialization
// ============================================

export async function initStorage(): Promise<void> {
  // 先从配置加载工作目录
  await loadStorageRootFromConfig();

  const storageRoot = getStorageRoot();
  await fs.mkdir(storageRoot, { recursive: true });
  console.log('[Storage] Initialized with root:', storageRoot);
}

// ============================================
// Draft CRUD Operations
// ============================================

export async function listDrafts(): Promise<Draft[]> {
  const storageRoot = getStorageRoot();

  try {
    const entries = await fs.readdir(storageRoot, { withFileTypes: true });
    const drafts: Draft[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // 跳过隐藏文件夹和系统文件夹
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

      const metaPath = getMetaPath(entry.name);

      try {
        // 尝试读取现有的 meta.json
        const meta = await readJson<Draft | null>(metaPath, null);
        if (meta) {
          // 文件夹名 = id = name，始终用文件夹名覆盖
          const needsUpdate = meta.id !== entry.name || meta.name !== entry.name;
          meta.id = entry.name;
          meta.name = entry.name;
          meta.storagePath = entry.name;
          if (needsUpdate) {
            await writeJson(metaPath, meta);
            console.log('[Storage] Fixed draft to match folder name:', entry.name);
          }
          drafts.push(meta);
          continue;
        }
      } catch {
        // meta.json 不存在或无效
      }

      // 自动创建草稿元数据（把文件夹识别为草稿）
      const now = new Date().toISOString();
      const newDraft: Draft = {
        id: entry.name,
        name: entry.name,  // 用文件夹名作为草稿名
        createdAt: now,
        updatedAt: now,
        storagePath: entry.name,
      };

      // 确保必要的子目录存在
      await fs.mkdir(getFilesPath(entry.name), { recursive: true });
      await fs.mkdir(getThumbnailsPath(entry.name), { recursive: true });
      await writeJson(metaPath, newDraft);
      await writeJson(getTasksPath(entry.name), { tasks: [] });

      // 检查是否需要创建 关联.json
      const linksPath = getLinksPath(entry.name);
      try {
        await fs.access(linksPath);
      } catch {
        await writeJson(linksPath, DEFAULT_LINKS);
      }

      console.log('[Storage] Auto-created draft for folder:', entry.name);
      drafts.push(newDraft);
    }

    // Sort by updatedAt descending
    drafts.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return drafts;
  } catch {
    return [];
  }
}

export async function getDraft(id: string): Promise<Draft | null> {
  const metaPath = getMetaPath(id);
  return readJson<Draft | null>(metaPath, null);
}

export async function createDraft(name: string): Promise<Draft> {
  // 生成唯一的文件夹名（用草稿名，处理非法字符和重名）
  const folderName = await getUniqueFolderName(name);
  const now = new Date().toISOString();

  // 文件夹名 = id = name
  const draft: Draft = {
    id: folderName,
    name: folderName,
    createdAt: now,
    updatedAt: now,
    storagePath: folderName,
  };

  const draftPath = getDraftPath(folderName);
  await fs.mkdir(draftPath, { recursive: true });
  await fs.mkdir(getThumbnailsPath(folderName), { recursive: true });
  await fs.mkdir(getFilesPath(folderName), { recursive: true });

  await writeJson(getMetaPath(folderName), draft);
  // 注意：resources.json 已废弃，资源列表通过扫描文件系统获取
  await writeJson(getTasksPath(folderName), { tasks: [] });
  await writeJson(getLinksPath(folderName), DEFAULT_LINKS);

  return draft;
}

export async function updateDraft(id: string, updates: Partial<Draft>): Promise<Draft | null> {
  const draft = await getDraft(id);
  if (!draft) {
    return null;
  }

  let newId = id;

  // 如果名字改变，重命名文件夹（文件夹名 = 草稿名 = ID）
  if (updates.name && updates.name !== id) {
    // 生成新的文件夹名
    const newFolderName = await getUniqueFolderName(updates.name, id);
    console.log('[Storage] updateDraft: renaming', id, '->', newFolderName);

    if (newFolderName !== id) {
      const oldPath = getDraftPath(id);
      const newPath = getDraftPath(newFolderName);

      // 清除缩略图索引缓存（释放可能的内存引用）
      clearThumbnailIndexCache(oldPath);

      // 尝试重命名，最多重试 5 次，逐渐增加等待时间
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(oldPath, newPath);
          newId = newFolderName;
          console.log('[Storage] Draft folder renamed:', id, '->', newFolderName);
          lastError = null;
          break;
        } catch (err) {
          lastError = err as Error;
          const waitTime = 500 * (attempt + 1); // 500ms, 1s, 1.5s, 2s, 2.5s
          console.log('[Storage] Rename attempt', attempt + 1, 'failed, waiting', waitTime, 'ms...');
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      if (lastError) {
        throw new Error('重命名失败，请关闭正在播放的视频后重试');
      }
    }
  }

  // 草稿名 = 文件夹名 = ID
  const updatedDraft: Draft = {
    id: newId,
    name: newId,
    createdAt: draft.createdAt,
    updatedAt: new Date().toISOString(),
    storagePath: newId,
  };

  await writeJson(getMetaPath(newId), updatedDraft);
  return updatedDraft;
}

export async function deleteDraft(id: string): Promise<boolean> {
  const draftPath = getDraftPath(id);

  try {
    await fs.rm(draftPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 复制草稿
 * @param sourceId 源草稿 ID
 * @param newName 新草稿名称
 * @returns 新创建的草稿
 */
export async function copyDraft(sourceId: string, newName: string): Promise<Draft> {
  const sourceDraft = await getDraft(sourceId);
  if (!sourceDraft) {
    throw new Error('Source draft not found');
  }

  // 生成唯一的文件夹名（用新草稿名）
  const newFolderName = await getUniqueFolderName(newName);
  const now = new Date().toISOString();
  const sourcePath = getDraftPath(sourceId);
  const targetPath = getDraftPath(newFolderName);

  // 递归复制整个草稿文件夹
  await copyDirectory(sourcePath, targetPath);

  // 更新新草稿的 meta.json（文件夹名 = id = name）
  const newDraft: Draft = {
    id: newFolderName,
    name: newFolderName,
    createdAt: now,
    updatedAt: now,
    storagePath: newFolderName,
  };
  await writeJson(getMetaPath(newFolderName), newDraft);

  // 删除复制过来的旧文件（如果存在）
  // resources.json 已废弃
  const oldResourcesPath = path.join(targetPath, 'resources.json');
  try {
    await fs.unlink(oldResourcesPath);
  } catch {
    // 文件可能不存在
  }

  // 删除旧位置的 links.json（已移到 files/关联.json）
  const oldLinksPath = path.join(targetPath, 'links.json');
  try {
    await fs.unlink(oldLinksPath);
  } catch {
    // 文件可能不存在
  }

  // 清空 tasks.json（任务不需要复制）
  await writeJson(getTasksPath(newFolderName), { tasks: [] });

  // 复制关联关系到新位置 files/关联.json
  const sourceLinks = await loadLinks(sourceId);
  await writeJson(getLinksPath(newFolderName), sourceLinks);

  console.log('[Storage] Copied draft:', sourceId, '->', newFolderName);
  return newDraft;
}

/**
 * 递归复制目录
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ============================================
// Resource CRUD Operations
// ============================================

// 注意：resources.json 已废弃
// 资源列表现在通过扫描文件系统动态获取
// 资源 ID 为相对路径（如 '分镜源视频/001.mp4'）

/**
 * 列出草稿中的资源
 * 通过扫描文件系统获取，不再依赖 resources.json
 */
export async function listResources(draftId: string, type?: ResourceType): Promise<Resource[]> {
  return scanResources(draftId, type);
}

/**
 * 获取单个资源
 * resourceId 为相对路径（如 '分镜源视频/001.mp4'）
 * 优化：直接根据路径读取单个文件，不扫描整个目录
 */
export async function getResource(draftId: string, resourceId: string): Promise<Resource | null> {
  const filesDir = getFilesPath(draftId);
  const filePath = path.join(filesDir, resourceId);

  try {
    // 检查文件是否存在
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      console.log('[Storage:getResource] not a file:', filePath);
      return null;
    }

    // 获取资源类型
    const resourceType = getResourceTypeFromPath(resourceId);
    if (!resourceType) {
      console.log('[Storage:getResource] invalid resourceType for:', resourceId);
      return null;
    }

    // 提取元数据（使用持久化缓存）
    const draftPath = getDraftPath(draftId);
    const metadata = await extractMetadata(filePath, resourceType, draftPath);

    const resource: Resource = {
      id: resourceId,
      draftId,
      type: resourceType,
      fileName: path.basename(filePath),
      filePath,
      fileSize: stat.size,
      mimeType: getMimeType(filePath),
      metadata,
      createdAt: stat.birthtime.toISOString(),
    };

    return resource;
  } catch (err) {
    // 文件不存在或读取失败
    console.log('[Storage:getResource] error for:', filePath, (err as Error).message);
    return null;
  }
}

/**
 * 删除资源
 * 直接删除文件
 */
export async function deleteResource(draftId: string, resourceId: string): Promise<boolean> {
  const filesDir = getFilesPath(draftId);
  const filePath = path.join(filesDir, resourceId);

  try {
    await fs.unlink(filePath);
    // 尝试删除伴随 JSON 文件（忽略不存在）
    try { await fs.unlink(getCompanionPath(filePath)); } catch {}
    try { await fs.unlink(filePath + '.分割点.json'); } catch {} // 向后兼容旧格式
    await updateDraft(draftId, {});
    return true;
  } catch (err) {
    const errorCode = (err as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') {
      return true; // 文件不存在视为成功
    }
    console.error('[Storage] Failed to delete:', filePath, err);
    return false;
  }
}

// ============================================
// Resource Companion JSON (伴随元数据文件)
// ============================================

/**
 * 获取资源文件的伴随 JSON 路径
 * 如 001.mp4 → 001.json, 002_example.png → 002_example.json
 */
function getCompanionPath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, parsed.name + '.json');
}

function getCompanionJsonPath(draftId: string, resourceId: string): string {
  return getCompanionPath(path.join(getFilesPath(draftId), resourceId));
}

/**
 * 加载资源元数据（伴随 JSON）
 * 内含向后兼容：若新格式不存在，尝试读取旧格式 .分割点.json 并自动迁移
 */
export async function loadResourceMeta(
  draftId: string,
  resourceId: string
): Promise<ResourceMetadataFile | null> {
  const jsonPath = getCompanionJsonPath(draftId, resourceId);
  let data = await readJson<ResourceMetadataFile | null>(jsonPath, null);

  // 向后兼容：尝试读取旧格式 .分割点.json
  if (!data) {
    const oldPath = path.join(getFilesPath(draftId), resourceId + '.分割点.json');
    const oldData = await readJson<any>(oldPath, null);
    if (oldData) {
      // 迁移为新格式
      data = {
        splitPoints: {
          duration: oldData.duration,
          fps: oldData.fps,
          points: oldData.splitPoints,
        },
        savedAt: oldData.savedAt || new Date().toISOString(),
      };
      // 保存新格式，删除旧文件
      await writeJson(jsonPath, data);
      try { await fs.unlink(oldPath); } catch {}
      console.log('[Storage] Migrated split points to new format:', resourceId);
    }
  }

  return data;
}

/**
 * 保存/合并资源元数据（不覆盖其他字段）
 */
export async function saveResourceMeta(
  draftId: string,
  resourceId: string,
  update: Partial<ResourceMetadataFile>
): Promise<void> {
  const jsonPath = getCompanionJsonPath(draftId, resourceId);
  const existing = await readJson<Partial<ResourceMetadataFile>>(jsonPath, {});
  await writeJson(jsonPath, {
    ...existing,
    ...update,
    savedAt: new Date().toISOString(),
  });
}

// --- Split Points 兼容 API ---

export async function saveSplitPoints(
  draftId: string,
  resourceId: string,
  data: { duration: number; fps: number; splitPoints: Array<{ id: string; time: number; frame: number; isAutoDetected: boolean }> }
): Promise<void> {
  await saveResourceMeta(draftId, resourceId, {
    splitPoints: {
      duration: data.duration,
      fps: data.fps,
      points: data.splitPoints,
    },
  });
}

export async function loadSplitPoints(
  draftId: string,
  resourceId: string
): Promise<{ duration: number; fps: number; splitPoints: Array<{ id: string; time: number; frame: number; isAutoDetected: boolean }> } | null> {
  const meta = await loadResourceMeta(draftId, resourceId);
  if (!meta?.splitPoints) return null;
  return {
    duration: meta.splitPoints.duration,
    fps: meta.splitPoints.fps,
    splitPoints: meta.splitPoints.points,
  };
}

export async function deleteSplitPoints(draftId: string, resourceId: string): Promise<boolean> {
  // 删除新格式伴随 JSON
  const jsonPath = getCompanionJsonPath(draftId, resourceId);
  try { await fs.unlink(jsonPath); } catch {}
  // 向后兼容：删除旧格式
  const oldPath = path.join(getFilesPath(draftId), resourceId + '.分割点.json');
  try { await fs.unlink(oldPath); } catch {}
  return true;
}

// ============================================
// Task CRUD Operations
// ============================================

interface TasksFile {
  tasks: ProcessingTask[];
}

export async function listTasks(draftId: string): Promise<ProcessingTask[]> {
  const tasksPath = getTasksPath(draftId);
  const data = await readJson<TasksFile>(tasksPath, { tasks: [] });
  return data.tasks;
}

export async function getTask(draftId: string, taskId: string): Promise<ProcessingTask | null> {
  const tasks = await listTasks(draftId);
  return tasks.find((t) => t.id === taskId) || null;
}

export async function addTask(draftId: string, task: Omit<ProcessingTask, 'id' | 'draftId' | 'createdAt'>): Promise<ProcessingTask> {
  const tasksPath = getTasksPath(draftId);
  const data = await readJson<TasksFile>(tasksPath, { tasks: [] });

  const newTask: ProcessingTask = {
    ...task,
    id: uuidv4(),
    draftId,
    createdAt: new Date().toISOString(),
  };

  data.tasks.push(newTask);
  await writeJson(tasksPath, data);

  return newTask;
}

export async function updateTask(
  draftId: string,
  taskId: string,
  updates: Partial<ProcessingTask>
): Promise<ProcessingTask | null> {
  const tasksPath = getTasksPath(draftId);
  const data = await readJson<TasksFile>(tasksPath, { tasks: [] });

  const index = data.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return null;

  data.tasks[index] = {
    ...data.tasks[index],
    ...updates,
    id: taskId,
    draftId,
  };

  await writeJson(tasksPath, data);
  return data.tasks[index];
}

// ============================================
// Links CRUD Operations (分镜关联关系)
// ============================================

/**
 * 关联关系数据结构
 * 注意：customOrder 已废弃，排序现在通过文件名序号实现
 */
export interface LinksFile {
  // 分镜源视频 -> 分镜新视频 的关联映射
  sourceToNew: Record<string, string>;
}

const DEFAULT_LINKS: LinksFile = {
  sourceToNew: {},
};

/**
 * 加载关联关系
 */
export async function loadLinks(draftId: string): Promise<LinksFile> {
  const linksPath = getLinksPath(draftId);
  return await readJson<LinksFile>(linksPath, DEFAULT_LINKS);
}

/**
 * 保存关联关系
 */
export async function saveLinks(draftId: string, links: LinksFile): Promise<void> {
  const linksPath = getLinksPath(draftId);
  await writeJson(linksPath, links);
}

// ============================================
// 提示词历史
// ============================================

export interface PromptHistoryFile {
  prompts: string[];
}

const DEFAULT_PROMPT_HISTORY: PromptHistoryFile = {
  prompts: [],
};

const MAX_PROMPT_HISTORY = 50;

export async function loadPromptHistory(draftId: string): Promise<PromptHistoryFile> {
  const filePath = getPromptHistoryPath(draftId);
  return await readJson<PromptHistoryFile>(filePath, DEFAULT_PROMPT_HISTORY);
}

export async function savePromptHistory(draftId: string, prompt: string): Promise<PromptHistoryFile> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return await loadPromptHistory(draftId);
  }
  const history = await loadPromptHistory(draftId);
  history.prompts = [trimmed, ...history.prompts.filter((p) => p !== trimmed)].slice(0, MAX_PROMPT_HISTORY);
  const filePath = getPromptHistoryPath(draftId);
  await writeJson(filePath, history);
  return history;
}

export async function removePromptHistory(draftId: string, prompt: string): Promise<PromptHistoryFile> {
  const history = await loadPromptHistory(draftId);
  history.prompts = history.prompts.filter((p) => p !== prompt);
  const filePath = getPromptHistoryPath(draftId);
  await writeJson(filePath, history);
  return history;
}

// ============================================
// Draft Thumbnail (轻量级：只找第一个媒体文件路径)
// ============================================

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

/**
 * 获取草稿中第一个视频或图片文件的路径和媒体类型
 * 按 section 顺序 → 文件名排序，找到即停止
 */
export async function getFirstMediaFilePath(draftId: string): Promise<{ filePath: string; mediaType: 'video' | 'image' } | null> {
  const filesDir = getFilesPath(draftId);
  try {
    await fs.access(filesDir);
  } catch {
    return null;
  }

  const sections = await scanSections(draftId);
  for (const section of sections) {
    const folderPath = path.join(filesDir, section.id);
    try {
      const entries = await fs.readdir(folderPath);
      const sorted = entries.filter(n => !n.startsWith('.') && !n.startsWith('_temp_') && !n.endsWith('.json')).sort();
      for (const name of sorted) {
        const ext = path.extname(name).toLowerCase();
        if (VIDEO_EXTS.has(ext)) {
          return { filePath: path.join(folderPath, name), mediaType: 'video' };
        }
        if (IMAGE_EXTS.has(ext)) {
          return { filePath: path.join(folderPath, name), mediaType: 'image' };
        }
      }
    } catch {
      // 文件夹不存在，跳过
    }
  }
  return null;
}

// ============================================
// Exports
// ============================================

export const storage = {
  init: initStorage,
  getStorageRoot,
  getDefaultStorageRoot,
  setStorageRoot,
  saveStorageRootToConfig,
  getDraftPath,
  getThumbnailsPath,
  getFilesPath,
  getResourceFilePath,
  getResourceFolderPath,
  getResourceTypeFromPath,
  getNextSequenceNumber,
  scanResources,
  // Section 管理
  scanSections,
  createSection,
  deleteSection,
  renameSection,
  reorderSections,
  // 文件序号命名相关
  getSequenceFromFileName,
  getOriginalNameFromFileName,
  makeSequencedFileName,
  reorderResourceFiles,
  renumberResourceFiles,
  draft: {
    list: listDrafts,
    get: getDraft,
    create: createDraft,
    update: updateDraft,
    delete: deleteDraft,
    copy: copyDraft,
  },
  resource: {
    list: listResources,
    get: getResource,
    delete: deleteResource,
    // 注意：addResource 和 updateResource 已移除
    // 资源通过文件系统直接管理，添加资源请直接复制文件到相应文件夹
  },
  task: {
    list: listTasks,
    get: getTask,
    add: addTask,
    update: updateTask,
  },
  links: {
    load: loadLinks,
    save: saveLinks,
  },
  promptHistory: {
    load: loadPromptHistory,
    save: savePromptHistory,
    remove: removePromptHistory,
  },
  splitPoints: {
    save: saveSplitPoints,
    load: loadSplitPoints,
    delete: deleteSplitPoints,
  },
  metadata: {
    load: loadResourceMeta,
    save: saveResourceMeta,
  },
  getCompanionPath,
};

export default storage;
