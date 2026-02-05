import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Draft, Resource, ResourceType, ProcessingTask, ResourceMetadata } from '@shared/types';
import { loadConfig, saveConfig } from './config';
import { extractMetadata, getMimeType } from './metadata';

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

/**
 * 资源类型到文件夹/文件名的映射
 *
 * 规则：
 * - 源视频：文件名 "源视频.{ext}"
 * - 原角色图片：文件夹 "原角色图片/"
 * - 提示词：文件夹 "提示词/"
 * - 新角色图片：文件夹 "新角色图片/"
 * - 分镜源视频：文件夹 "分镜源视频/"
 * - 分镜新视频：文件夹 "分镜新视频/"
 * - 高清分镜新视频：文件夹 "高清分镜新视频/"
 * - 对口型新视频：文件夹 "对口型新视频/"
 * - 合成新视频：文件名 "合成新视频.{ext}"
 */
interface ResourcePathConfig {
  isFolder: boolean;
  name: string;
}

const RESOURCE_PATH_CONFIG: Record<ResourceType, ResourcePathConfig> = {
  'source_video': { isFolder: false, name: '源视频' },
  'source_character': { isFolder: true, name: '源角色图片' },
  'prompt': { isFolder: true, name: '提示词' },
  'new_character': { isFolder: true, name: '新角色图片' },
  'scene_source': { isFolder: true, name: '分镜源视频' },
  'scene_new': { isFolder: true, name: '分镜新视频' },
  'scene_hd': { isFolder: true, name: '高清分镜新视频' },
  'lipsync': { isFolder: true, name: '对口型新视频' },
  'synthesized': { isFolder: true, name: '合成新视频' },
};

/**
 * 获取资源文件的目标路径
 * @param draftId 草稿ID
 * @param resourceType 资源类型
 * @param ext 文件扩展名（包含点号，如 ".mp4"）
 * @param sequenceNumber 序号（用于文件夹内多个文件的情况）
 */
export function getResourceFilePath(
  draftId: string,
  resourceType: ResourceType,
  ext: string,
  sequenceNumber?: number
): string {
  const filesDir = getFilesPath(draftId);
  const config = RESOURCE_PATH_CONFIG[resourceType];

  if (config.isFolder) {
    // 放在子文件夹中，使用序号命名
    const folderPath = path.join(filesDir, config.name);
    const fileName = sequenceNumber !== undefined
      ? `${sequenceNumber.toString().padStart(3, '0')}${ext}`
      : `001${ext}`;
    return path.join(folderPath, fileName);
  } else {
    // 直接在 files 文件夹中，使用固定名称
    return path.join(filesDir, `${config.name}${ext}`);
  }
}

/**
 * 获取资源文件夹路径（仅对 isFolder=true 的资源类型有效）
 */
export function getResourceFolderPath(draftId: string, resourceType: ResourceType): string | null {
  const config = RESOURCE_PATH_CONFIG[resourceType];
  if (!config.isFolder) {
    return null;
  }
  return path.join(getFilesPath(draftId), config.name);
}

// ============================================
// 文件夹名 -> 资源类型 反向映射
// ============================================

const FOLDER_NAME_TO_TYPE: Record<string, ResourceType> = {};
for (const [type, config] of Object.entries(RESOURCE_PATH_CONFIG)) {
  FOLDER_NAME_TO_TYPE[config.name] = type as ResourceType;
}

/**
 * 从相对路径获取资源类型
 * 例如：'分镜源视频/001.mp4' -> 'scene_source'
 *       '源视频.mp4' -> 'source_video'
 */
export function getResourceTypeFromPath(relativePath: string): ResourceType | null {
  const parts = relativePath.split(/[/\\]/);

  if (parts.length === 1) {
    // 顶层文件，检查是否是源视频或合成新视频
    const fileName = parts[0];
    for (const [type, config] of Object.entries(RESOURCE_PATH_CONFIG)) {
      if (!config.isFolder) {
        // 文件名以配置名开头（如 "源视频.mp4"）
        const baseName = path.parse(fileName).name;
        if (baseName === config.name) {
          return type as ResourceType;
        }
      }
    }
    return null;
  }

  // 在子文件夹中
  const folderName = parts[0];
  return FOLDER_NAME_TO_TYPE[folderName] || null;
}

// ============================================
// 元数据缓存
// ============================================

interface MetadataCacheEntry {
  metadata: ResourceMetadata;
  mtimeMs: number; // 文件修改时间戳
  size: number;    // 文件大小
}

// 内存缓存：draftId -> relativePath -> cache entry
const metadataCache = new Map<string, Map<string, MetadataCacheEntry>>();

/**
 * 清除指定草稿的元数据缓存
 */
export function clearMetadataCache(draftId: string): void {
  metadataCache.delete(draftId);
}

/**
 * 清除所有元数据缓存
 */
export function clearAllMetadataCache(): void {
  metadataCache.clear();
}

// ============================================
// 扫描资源文件系统
// ============================================

/**
 * 扫描草稿的 files 目录获取所有资源
 * 资源 ID 为相对路径（如 '分镜源视频/001.mp4'）
 */
export async function scanResources(draftId: string, type?: ResourceType): Promise<Resource[]> {
  const filesDir = getFilesPath(draftId);
  const resources: Resource[] = [];

  // 获取或创建该草稿的缓存
  if (!metadataCache.has(draftId)) {
    metadataCache.set(draftId, new Map());
  }
  const draftCache = metadataCache.get(draftId)!;

  try {
    await fs.access(filesDir);
  } catch {
    // files 目录不存在
    return resources;
  }

  // 遍历每种资源类型
  for (const [resourceType, config] of Object.entries(RESOURCE_PATH_CONFIG)) {
    // 如果指定了类型筛选，跳过不匹配的类型
    if (type && resourceType !== type) {
      continue;
    }

    if (config.isFolder) {
      // 文件夹型资源
      const folderPath = path.join(filesDir, config.name);
      try {
        const entries = await fs.readdir(folderPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile()) continue;

          // 忽略隐藏文件和临时文件
          if (entry.name.startsWith('.') || entry.name.startsWith('_temp_')) continue;

          const filePath = path.join(folderPath, entry.name);
          const relativePath = `${config.name}/${entry.name}`;

          const resource = await buildResource(
            draftId,
            relativePath,
            filePath,
            resourceType as ResourceType,
            entry.name,
            draftCache
          );

          if (resource) {
            resources.push(resource);
          }
        }
      } catch {
        // 文件夹不存在，跳过
      }
    } else {
      // 单文件型资源（源视频、合成新视频）
      // 查找匹配的文件（扩展名可能不同）
      try {
        const entries = await fs.readdir(filesDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile()) continue;

          const baseName = path.parse(entry.name).name;
          if (baseName === config.name) {
            const filePath = path.join(filesDir, entry.name);
            const relativePath = entry.name;

            const resource = await buildResource(
              draftId,
              relativePath,
              filePath,
              resourceType as ResourceType,
              entry.name,
              draftCache
            );

            if (resource) {
              resources.push(resource);
            }
          }
        }
      } catch {
        // 读取失败，跳过
      }
    }
  }

  // 按文件名排序（对于同类型资源）
  resources.sort((a, b) => {
    if (a.type !== b.type) {
      // 不同类型，按类型排序
      return a.type.localeCompare(b.type);
    }
    // 同类型，按文件名数字排序
    return a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true });
  });

  return resources;
}

/**
 * 构建单个资源对象
 */
async function buildResource(
  draftId: string,
  relativePath: string,
  filePath: string,
  resourceType: ResourceType,
  fileName: string,
  cache: Map<string, MetadataCacheEntry>
): Promise<Resource | null> {
  try {
    const stat = await fs.stat(filePath);

    // 检查缓存
    const cached = cache.get(relativePath);
    let metadata: ResourceMetadata;

    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      // 缓存命中
      metadata = cached.metadata;
    } else {
      // 提取元数据
      metadata = await extractMetadata(filePath, resourceType);

      // 更新缓存
      cache.set(relativePath, {
        metadata,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }

    const resource: Resource = {
      id: relativePath, // 使用相对路径作为 ID
      draftId,
      type: resourceType,
      fileName,
      filePath,
      fileSize: stat.size,
      mimeType: getMimeType(filePath),
      metadata,
      createdAt: stat.birthtime.toISOString(),
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
export async function getNextSequenceNumber(draftId: string, resourceType: ResourceType): Promise<number> {
  const folderPath = getResourceFolderPath(draftId, resourceType);
  if (!folderPath) {
    return 1;
  }

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
 * @returns 更新后的资源列表
 */
export async function reorderResourceFiles(
  draftId: string,
  resourceType: ResourceType,
  orderedResourceIds: string[]
): Promise<Resource[]> {
  // 通过扫描获取当前资源列表
  const allResources = await scanResources(draftId, resourceType);

  // 获取要重排序的资源
  const targetResources = allResources.filter(r => orderedResourceIds.includes(r.id));

  // 按新顺序排序
  const sortedResources = orderedResourceIds
    .map(id => targetResources.find(r => r.id === id))
    .filter((r): r is Resource => r !== undefined);

  if (sortedResources.length === 0) {
    return [];
  }

  const folderPath = getResourceFolderPath(draftId, resourceType);
  if (!folderPath) {
    return sortedResources;
  }

  const config = RESOURCE_PATH_CONFIG[resourceType];

  // 第一步：将所有文件重命名为临时名称，避免冲突
  const tempRenames: Array<{ resource: Resource; tempPath: string; originalName: string }> = [];
  for (const resource of sortedResources) {
    const ext = path.extname(resource.filePath);
    const tempFileName = `_temp_${uuidv4()}${ext}`;
    const tempPath = path.join(folderPath, tempFileName);
    const originalName = getOriginalNameFromFileName(resource.fileName);

    try {
      await fs.rename(resource.filePath, tempPath);
      tempRenames.push({ resource, tempPath, originalName });
    } catch (err) {
      console.error('[Storage] Failed to rename to temp:', resource.filePath, err);
      // 回滚已重命名的文件
      for (const { resource: r, tempPath: tp } of tempRenames) {
        try {
          await fs.rename(tp, r.filePath);
        } catch {
          // 忽略回滚失败
        }
      }
      throw err;
    }
  }

  // 第二步：按新顺序重命名为最终名称，同时构建 ID 映射
  const oldToNewIdMap = new Map<string, string>();
  const newResourceIds: string[] = [];
  for (let i = 0; i < tempRenames.length; i++) {
    const { resource, tempPath, originalName } = tempRenames[i];
    const newSequence = i + 1;
    const ext = path.extname(tempPath);
    const newFileName = makeSequencedFileName(newSequence, originalName, ext);
    const newPath = path.join(folderPath, newFileName);
    const newRelativePath = `${config.name}/${newFileName}`;

    try {
      await fs.rename(tempPath, newPath);
      newResourceIds.push(newRelativePath);
      // 记录旧 ID -> 新 ID 映射
      oldToNewIdMap.set(resource.id, newRelativePath);
    } catch (err) {
      console.error('[Storage] Failed to rename to final:', tempPath, '->', newPath, err);
      throw err;
    }
  }

  // 第三步：如果是 scene_source 或 scene_new，更新 links.json 中的引用
  if (resourceType === 'scene_source' || resourceType === 'scene_new') {
    await updateLinksOnReorder(draftId, resourceType, oldToNewIdMap);
  }

  // 清除缓存，让下次扫描重新加载
  clearMetadataCache(draftId);
  await updateDraft(draftId, {});

  // 重新扫描获取更新后的资源
  const updatedResources = await scanResources(draftId, resourceType);
  console.log('[Storage] Reordered', updatedResources.length, 'resources of type', resourceType);

  return updatedResources;
}

/**
 * 删除资源后重新整理序号
 * @param draftId 草稿ID
 * @param resourceType 资源类型
 */
export async function renumberResourceFiles(
  draftId: string,
  resourceType: ResourceType
): Promise<void> {
  const resources = await listResources(draftId, resourceType);
  if (resources.length === 0) {
    return;
  }

  // 按当前文件名排序
  const sorted = [...resources].sort((a, b) =>
    a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true })
  );

  // 重新排序
  await reorderResourceFiles(draftId, resourceType, sorted.map(r => r.id));
}

/**
 * 重排序后更新 links.json 中的资源引用
 * @param draftId 草稿ID
 * @param resourceType 资源类型（scene_source 或 scene_new）
 * @param oldToNewIdMap 旧 ID -> 新 ID 的映射
 */
async function updateLinksOnReorder(
  draftId: string,
  resourceType: ResourceType,
  oldToNewIdMap: Map<string, string>
): Promise<void> {
  if (oldToNewIdMap.size === 0) return;

  try {
    const links = await loadLinks(draftId);
    let updated = false;

    if (resourceType === 'scene_source') {
      // 更新 sourceToNew 的键（source ID）
      const newSourceToNew: Record<string, string> = {};
      for (const [oldSourceId, newId] of Object.entries(links.sourceToNew)) {
        const newSourceId = oldToNewIdMap.get(oldSourceId) || oldSourceId;
        newSourceToNew[newSourceId] = newId;
        if (newSourceId !== oldSourceId) {
          updated = true;
        }
      }
      links.sourceToNew = newSourceToNew;
    } else if (resourceType === 'scene_new') {
      // 更新 sourceToNew 的值（new ID）
      for (const [sourceId, oldNewId] of Object.entries(links.sourceToNew)) {
        const newNewId = oldToNewIdMap.get(oldNewId);
        if (newNewId) {
          links.sourceToNew[sourceId] = newNewId;
          updated = true;
        }
      }
    }

    if (updated) {
      await saveLinks(draftId, links);
      console.log('[Storage] Updated links.json after reorder:', resourceType);
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
      if (entry.isDirectory()) {
        const metaPath = getMetaPath(entry.name);
        try {
          const meta = await readJson<Draft>(metaPath, null as unknown as Draft);
          if (meta) {
            drafts.push(meta);
          }
        } catch {
          // Skip invalid draft directories
        }
      }
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
  const id = uuidv4();
  const now = new Date().toISOString();

  const draft: Draft = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    storagePath: id,
  };

  const draftPath = getDraftPath(id);
  await fs.mkdir(draftPath, { recursive: true });
  await fs.mkdir(getThumbnailsPath(id), { recursive: true });
  await fs.mkdir(getFilesPath(id), { recursive: true });

  await writeJson(getMetaPath(id), draft);
  // 注意：resources.json 已废弃，资源列表通过扫描文件系统获取
  await writeJson(getTasksPath(id), { tasks: [] });
  await writeJson(getLinksPath(id), DEFAULT_LINKS);

  return draft;
}

export async function updateDraft(id: string, updates: Partial<Draft>): Promise<Draft | null> {
  const draft = await getDraft(id);
  if (!draft) return null;

  const updatedDraft: Draft = {
    ...draft,
    ...updates,
    id, // Ensure ID cannot be changed
    updatedAt: new Date().toISOString(),
  };

  await writeJson(getMetaPath(id), updatedDraft);
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

  const newId = uuidv4();
  const now = new Date().toISOString();
  const sourcePath = getDraftPath(sourceId);
  const targetPath = getDraftPath(newId);

  // 递归复制整个草稿文件夹
  await copyDirectory(sourcePath, targetPath);

  // 更新新草稿的 meta.json
  const newDraft: Draft = {
    id: newId,
    name: newName,
    createdAt: now,
    updatedAt: now,
    storagePath: newId,
  };
  await writeJson(getMetaPath(newId), newDraft);

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
  await writeJson(getTasksPath(newId), { tasks: [] });

  // 复制关联关系到新位置 files/关联.json
  const sourceLinks = await loadLinks(sourceId);
  await writeJson(getLinksPath(newId), sourceLinks);

  console.log('[Storage] Copied draft:', sourceId, '->', newId);
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
 */
export async function getResource(draftId: string, resourceId: string): Promise<Resource | null> {
  const resources = await listResources(draftId);
  return resources.find((r) => r.id === resourceId) || null;
}

/**
 * 删除资源
 * 直接删除文件，不再需要更新 resources.json
 */
export async function deleteResource(draftId: string, resourceId: string): Promise<boolean> {
  const filesDir = getFilesPath(draftId);
  const filePath = path.join(filesDir, resourceId);

  try {
    await fs.unlink(filePath);

    // 清除该资源的缓存
    const draftCache = metadataCache.get(draftId);
    if (draftCache) {
      draftCache.delete(resourceId);
    }

    // 同时尝试删除缩略图
    const thumbnailsDir = getThumbnailsPath(draftId);
    const thumbnailPath = path.join(thumbnailsDir, resourceId.replace(/[/\\]/g, '_') + '.jpg');
    try {
      await fs.unlink(thumbnailPath);
    } catch {
      // 缩略图可能不存在
    }

    await updateDraft(draftId, {});
    return true;
  } catch (err) {
    console.error('[Storage] Failed to delete resource:', filePath, err);
    return false;
  }
}

// ============================================
// Split Points Storage
// ============================================

function getSplitPointsPath(draftId: string, _videoId: string): string {
  // 使用固定的文件名，存储在 files 目录下
  return path.join(getFilesPath(draftId), '分割点.txt');
}

interface SplitPointsFile {
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

export async function saveSplitPoints(
  draftId: string,
  videoId: string,
  data: Omit<SplitPointsFile, 'savedAt'>
): Promise<void> {
  const filePath = getSplitPointsPath(draftId, videoId);
  await writeJson(filePath, {
    ...data,
    savedAt: new Date().toISOString(),
  });
}

export async function loadSplitPoints(
  draftId: string,
  videoId: string
): Promise<SplitPointsFile | null> {
  const filePath = getSplitPointsPath(draftId, videoId);
  return readJson<SplitPointsFile | null>(filePath, null);
}

export async function deleteSplitPoints(draftId: string, videoId: string): Promise<boolean> {
  const filePath = getSplitPointsPath(draftId, videoId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
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
// File Cleanup
// ============================================

/**
 * 递归获取目录下所有文件路径
 */
async function getAllFilesRecursive(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getAllFilesRecursive(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录不存在或无法读取
  }

  return files;
}

// 不应被清理的特殊文件名（如分割点文件、关联文件）
const PROTECTED_FILES = ['分割点.txt', '关联.json'];

/**
 * 清理草稿中的临时文件和空文件夹
 * 注意：现在资源列表通过扫描获取，这个函数主要用于清理临时文件
 * @returns 删除的文件数量
 */
export async function cleanupOrphanedFiles(draftId: string): Promise<number> {
  const filesDir = getFilesPath(draftId);
  const resources = await listResources(draftId);

  // 获取所有被引用的文件路径（规范化为绝对路径）
  const referencedPaths = new Set(
    resources.map(r => path.normalize(r.filePath))
  );

  // 获取 files 目录下的所有文件
  const allFiles = await getAllFilesRecursive(filesDir);

  let deletedCount = 0;

  for (const filePath of allFiles) {
    const normalizedPath = path.normalize(filePath);
    const fileName = path.basename(filePath);

    // 跳过受保护的文件（如分割点文件）
    if (PROTECTED_FILES.includes(fileName)) {
      continue;
    }

    // 如果文件不在引用列表中，删除它
    if (!referencedPaths.has(normalizedPath)) {
      try {
        await fs.unlink(filePath);
        deletedCount++;
        console.log('[Storage] Deleted orphaned file:', filePath);
      } catch (err) {
        console.error('[Storage] Failed to delete orphaned file:', filePath, err);
      }
    }
  }

  // 清理空文件夹
  await cleanupEmptyFolders(filesDir);

  return deletedCount;
}

/**
 * 递归清理空文件夹
 */
async function cleanupEmptyFolders(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(dirPath, entry.name);
        // 先递归清理子目录
        await cleanupEmptyFolders(subDirPath);

        // 检查子目录是否为空
        try {
          const subEntries = await fs.readdir(subDirPath);
          if (subEntries.length === 0) {
            await fs.rmdir(subDirPath);
            console.log('[Storage] Deleted empty folder:', subDirPath);
          }
        } catch {
          // 目录可能已被删除
        }
      }
    }
  } catch {
    // 目录不存在或无法读取
  }
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
  cleanupOrphanedFiles,
  clearMetadataCache,
  clearAllMetadataCache,
  scanResources,
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
  splitPoints: {
    save: saveSplitPoints,
    load: loadSplitPoints,
    delete: deleteSplitPoints,
  },
};

export default storage;
