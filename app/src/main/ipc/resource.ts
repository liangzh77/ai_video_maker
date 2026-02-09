import { ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { RESOURCE_CHANNELS } from '@shared/ipc-channels';
import storage from '../services/storage';
import { extractMetadata, getResourceTypeFromMime, getMimeType } from '../services/metadata';
import thumbnailCache from '../services/thumbnailCache';
import type { Resource, ResourceType, OperationResult } from '@shared/types';

// ============================================
// Request Types
// ============================================

interface ResourceListRequest {
  draftId: string;
  type?: ResourceType;
}

interface ResourceGetRequest {
  id: string;
}

interface ResourceAddRequest {
  draftId: string;
  type: ResourceType;
  filePath: string;
}

interface ResourceAddBatchRequest {
  draftId: string;
  files: Array<{
    type: ResourceType;
    filePath: string;
  }>;
}

interface ResourceUpdateRequest {
  id: string;
  metadata?: Partial<Resource['metadata']>;
}

interface ResourceDeleteRequest {
  draftId: string;
  id: string;
}

interface ResourceOpenFolderRequest {
  id: string;
}

interface ResourceAddFrameRequest {
  draftId: string;
  type: ResourceType;
  imageData: string; // base64 encoded image data (without data URL prefix)
  fileName: string;
}

interface ResourceAddTextRequest {
  draftId: string;
  type: ResourceType;
  content: string;
}

interface ResourceCopyRequest {
  resourceId: string;
  targetType?: ResourceType; // 目标资源类型（用于跨类型复制，如 scene_source -> scene_new）
  targetDraftId?: string; // 目标草稿 ID（默认为原资源所在草稿）
  sourceDraftId?: string; // 源草稿 ID（如果提供则直接使用，避免遍历所有草稿）
}

interface ResourceReorderRequest {
  draftId: string;
  type: ResourceType;
  orderedIds: string[]; // 按新顺序排列的资源 ID 数组
}

interface ResourceThumbnailRequest {
  draftId: string;
  resourceId: string;
}

// ============================================
// Helper Functions
// ============================================

async function createResourceFromImageData(
  draftId: string,
  type: ResourceType,
  imageData: string,
  fileName: string
): Promise<Resource> {
  // Decode base64 image data
  const buffer = Buffer.from(imageData, 'base64');

  // 使用新的命名规范获取文件路径
  const ext = path.extname(fileName) || '.png';
  const sequenceNumber = await storage.getNextSequenceNumber(draftId, type);
  const destPath = storage.getResourceFilePath(draftId, type, ext, sequenceNumber);

  // 确保目录存在
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  // Write image data to file
  await fs.writeFile(destPath, buffer);

  // Get file stats
  const stats = await fs.stat(destPath);
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  // Extract metadata
  const metadata = await extractMetadata(destPath, type);

  // 构建相对路径作为资源 ID
  const config = { name: path.basename(path.dirname(destPath)) };
  const relativePath = `${config.name}/${path.basename(destPath)}`;

  // 直接构建资源对象（不再写入 resources.json）
  const resource: Resource = {
    id: relativePath,
    draftId,
    type,
    filePath: destPath,
    fileName: path.basename(destPath),
    fileSize: stats.size,
    mimeType,
    metadata,
    createdAt: new Date().toISOString(),
  };

  return resource;
}

async function createResourceFromText(
  draftId: string,
  type: ResourceType,
  content: string
): Promise<Resource> {
  console.log('createResourceFromText: Starting...', { draftId, type, contentLength: content?.length });

  // 使用新的命名规范获取文件路径
  const ext = '.txt';
  const sequenceNumber = await storage.getNextSequenceNumber(draftId, type);
  const destPath = storage.getResourceFilePath(draftId, type, ext, sequenceNumber);
  console.log('createResourceFromText: destPath =', destPath);

  // 确保目录存在
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  // Write text content to file
  await fs.writeFile(destPath, content, 'utf-8');
  console.log('createResourceFromText: File written');

  // Get file stats
  const stats = await fs.stat(destPath);
  console.log('createResourceFromText: File size =', stats.size);

  // 构建相对路径作为资源 ID
  const config = { name: path.basename(path.dirname(destPath)) };
  const relativePath = `${config.name}/${path.basename(destPath)}`;

  // 直接构建资源对象（不再写入 resources.json）
  const resource: Resource = {
    id: relativePath,
    draftId,
    type,
    filePath: destPath,
    fileName: path.basename(destPath),
    fileSize: stats.size,
    mimeType: 'text/plain',
    metadata: {
      content,
      encoding: 'utf-8',
    },
    createdAt: new Date().toISOString(),
  };

  console.log('createResourceFromText: Resource created:', resource.id);
  return resource;
}

async function createResourceFromFile(
  draftId: string,
  type: ResourceType,
  sourcePath: string
): Promise<Resource> {
  // Verify source file exists
  const sourceStats = await fs.stat(sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error('Path is not a file');
  }

  const originalFileName = path.basename(sourcePath);
  const ext = path.extname(originalFileName);
  const mimeType = getMimeType(sourcePath);

  console.log('[createResourceFromFile] Starting:', { draftId, type, sourcePath, originalFileName });

  // 某些资源类型保留原有文件名（仅限 isFolder=true 的类型）
  const keepOriginalNameTypes: ResourceType[] = ['scene_new', 'scene_hd', 'lipsync'];
  let destPath: string;
  let folderName: string;

  if (keepOriginalNameTypes.includes(type)) {
    // 保留原有文件名
    const folderPath = storage.getResourceFolderPath(draftId, type);
    console.log('[createResourceFromFile] Using original name, folderPath:', folderPath);
    if (!folderPath) {
      throw new Error(`Cannot get folder path for type: ${type}`);
    }
    destPath = path.join(folderPath, originalFileName);
    folderName = path.basename(folderPath);
    console.log('[createResourceFromFile] destPath with original name:', destPath);
  } else {
    // 使用新的命名规范获取文件路径
    const sequenceNumber = await storage.getNextSequenceNumber(draftId, type);
    destPath = storage.getResourceFilePath(draftId, type, ext, sequenceNumber);
    folderName = path.basename(path.dirname(destPath));
    console.log('[createResourceFromFile] destPath with sequence:', destPath);
  }

  // 确保目录存在
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  // Copy file to storage
  await fs.copyFile(sourcePath, destPath);

  // Get new file stats
  const stats = await fs.stat(destPath);

  // Extract metadata from copied file
  const metadata = await extractMetadata(destPath, type);

  // 构建相对路径作为资源 ID
  const filesDir = storage.getFilesPath(draftId);
  const relativePath = path.relative(filesDir, destPath).replace(/\\/g, '/');

  // 直接构建资源对象（不再写入 resources.json）
  const resource: Resource = {
    id: relativePath,
    draftId,
    type,
    filePath: destPath,
    fileName: path.basename(destPath),
    fileSize: stats.size,
    mimeType,
    metadata,
    createdAt: stats.birthtime.toISOString(),
  };

  console.log('[createResourceFromFile] Resource created:', resource.id);
  return resource;
}

// ============================================
// IPC Handlers
// ============================================

export function registerResourceHandlers(): void {
  // List resources
  ipcMain.handle(
    RESOURCE_CHANNELS.LIST,
    async (_, request: ResourceListRequest): Promise<Resource[]> => {
      return storage.resource.list(request.draftId, request.type);
    }
  );

  // Get single resource
  ipcMain.handle(
    RESOURCE_CHANNELS.GET,
    async (_, request: ResourceGetRequest): Promise<Resource | null> => {
      // Need to search across all drafts since we only have resource ID
      const drafts = await storage.draft.list();
      for (const draft of drafts) {
        const resource = await storage.resource.get(draft.id, request.id);
        if (resource) {
          return resource;
        }
      }
      return null;
    }
  );

  // Add resource
  ipcMain.handle(
    RESOURCE_CHANNELS.ADD,
    async (_, request: ResourceAddRequest): Promise<OperationResult<Resource>> => {
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // Verify file exists
        try {
          await fs.access(request.filePath);
        } catch {
          return { success: false, error: 'FILE_NOT_FOUND' };
        }

        // Verify file format is supported
        const mimeType = getMimeType(request.filePath);
        const expectedType = getResourceTypeFromMime(mimeType);
        if (!expectedType) {
          return { success: false, error: 'FILE_FORMAT_UNSUPPORTED' };
        }

        const resource = await createResourceFromFile(
          request.draftId,
          request.type,
          request.filePath
        );

        return { success: true, data: resource };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add resource',
        };
      }
    }
  );

  // Add batch resources
  ipcMain.handle(
    RESOURCE_CHANNELS.ADD_BATCH,
    async (_, request: ResourceAddBatchRequest): Promise<OperationResult<Resource[]>> => {
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        const resources: Resource[] = [];
        const errors: string[] = [];

        for (const file of request.files) {
          try {
            const resource = await createResourceFromFile(
              request.draftId,
              file.type,
              file.filePath
            );
            resources.push(resource);
          } catch (err) {
            errors.push(`${file.filePath}: ${err instanceof Error ? err.message : 'Failed'}`);
          }
        }

        if (resources.length === 0 && errors.length > 0) {
          return { success: false, error: errors.join('; ') };
        }

        return { success: true, data: resources };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add resources',
        };
      }
    }
  );

  // Add frame as image resource (from base64 data)
  ipcMain.handle(
    RESOURCE_CHANNELS.ADD_FRAME,
    async (_, request: ResourceAddFrameRequest): Promise<OperationResult<Resource>> => {
      console.log('ADD_FRAME handler called:', { draftId: request.draftId, type: request.type, fileName: request.fileName, imageDataLength: request.imageData?.length });
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          console.error('ADD_FRAME: Draft not found:', request.draftId);
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        const resource = await createResourceFromImageData(
          request.draftId,
          request.type,
          request.imageData,
          request.fileName
        );

        console.log('ADD_FRAME: Resource created:', resource.id);
        return { success: true, data: resource };
      } catch (error) {
        console.error('ADD_FRAME error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add frame',
        };
      }
    }
  );

  // Add text resource (for prompts)
  ipcMain.handle(
    RESOURCE_CHANNELS.ADD_TEXT,
    async (_, request: ResourceAddTextRequest): Promise<OperationResult<Resource>> => {
      console.log('ADD_TEXT handler called:', { draftId: request.draftId, type: request.type, contentLength: request.content?.length });
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          console.error('ADD_TEXT: Draft not found:', request.draftId);
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        const resource = await createResourceFromText(
          request.draftId,
          request.type,
          request.content
        );

        console.log('ADD_TEXT: Resource created:', resource.id);
        return { success: true, data: resource };
      } catch (error) {
        console.error('ADD_TEXT error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to add text resource',
        };
      }
    }
  );

  // Update resource
  // 注意：由于资源信息现在通过扫描文件系统获取，此 handler 主要用于更新文本文件内容
  ipcMain.handle(
    RESOURCE_CHANNELS.UPDATE,
    async (_, request: ResourceUpdateRequest): Promise<OperationResult<Resource>> => {
      try {
        // Find the resource and its draft
        const drafts = await storage.draft.list();
        let foundDraftId: string | null = null;
        let foundResource: Resource | null = null;

        for (const draft of drafts) {
          const resource = await storage.resource.get(draft.id, request.id);
          if (resource) {
            foundDraftId = draft.id;
            foundResource = resource;
            break;
          }
        }

        if (!foundResource || !foundDraftId) {
          return { success: false, error: 'RESOURCE_NOT_FOUND' };
        }

        // 如果是文本资源（提示词），更新文件内容
        if (foundResource.mimeType === 'text/plain' && request.metadata && 'content' in request.metadata) {
          const textContent = request.metadata.content as string;
          try {
            await fs.writeFile(foundResource.filePath, textContent, 'utf-8');
            console.log('[Resource] Updated text file:', foundResource.filePath);
            // 注意：文本资源不使用缓存，每次都从文件读取
          } catch (err) {
            console.error('[Resource] Failed to update text file:', err);
            return { success: false, error: 'Failed to update text file' };
          }
        }

        // 重新获取更新后的资源
        const updatedResource = await storage.resource.get(foundDraftId, request.id);
        if (!updatedResource) {
          return { success: false, error: 'Failed to get updated resource' };
        }

        return { success: true, data: updatedResource };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update resource',
        };
      }
    }
  );

  // Copy resource (duplicate)
  ipcMain.handle(
    RESOURCE_CHANNELS.COPY,
    async (_, request: ResourceCopyRequest): Promise<OperationResult<Resource>> => {
      try {
        // Find the resource and its draft
        let foundDraftId: string | null = null;
        let foundResource: Resource | null = null;

        // 如果提供了 sourceDraftId，直接使用，避免遍历所有草稿
        if (request.sourceDraftId) {
          const resource = await storage.resource.get(request.sourceDraftId, request.resourceId);
          if (resource) {
            foundDraftId = request.sourceDraftId;
            foundResource = resource;
          }
        } else {
          // 后备：遍历所有草稿查找（较慢）
          const drafts = await storage.draft.list();
          for (const draft of drafts) {
            const resource = await storage.resource.get(draft.id, request.resourceId);
            if (resource) {
              foundDraftId = draft.id;
              foundResource = resource;
              break;
            }
          }
        }

        if (!foundDraftId || !foundResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND' };
        }

        // 确定目标类型和草稿
        const targetType = request.targetType || foundResource.type;
        const targetDraftId = request.targetDraftId || foundDraftId;

        // Copy the resource file to a new location
        const ext = path.extname(foundResource.filePath);
        let sequenceNumber = await storage.getNextSequenceNumber(targetDraftId, targetType);

        // 获取原始文件名（去掉序号前缀）用于新文件
        const originalName = storage.getOriginalNameFromFileName(foundResource.fileName);
        const folderPath = storage.getResourceFolderPath(targetDraftId, targetType);

        // Ensure directory exists
        const dirPath = folderPath || path.dirname(
          storage.getResourceFilePath(targetDraftId, targetType, ext, sequenceNumber)
        );
        await fs.mkdir(dirPath, { recursive: true });

        // 使用 COPYFILE_EXCL 防止覆盖已有文件，冲突时自动递增序号重试
        let newFilePath!: string;
        const MAX_RETRIES = 20;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          const fileName = storage.makeSequencedFileName(sequenceNumber, originalName, ext);
          newFilePath = folderPath
            ? path.join(folderPath, fileName)
            : storage.getResourceFilePath(targetDraftId, targetType, ext, sequenceNumber);

          try {
            await fs.copyFile(foundResource.filePath, newFilePath, fsConstants.COPYFILE_EXCL);
            break; // 复制成功
          } catch (err: any) {
            if (err.code === 'EEXIST' && retry < MAX_RETRIES - 1) {
              // 文件已存在（竞态条件），递增序号重试
              sequenceNumber++;
              continue;
            }
            throw err;
          }
        }

        // Get new file stats
        const stats = await fs.stat(newFilePath);

        // 构建相对路径作为资源 ID
        const filesDir = storage.getFilesPath(targetDraftId);
        const relativePath = path.relative(filesDir, newFilePath).replace(/\\/g, '/');

        // 直接构建资源对象（不再写入 resources.json）
        const newResource: Resource = {
          id: relativePath,
          draftId: targetDraftId,
          type: targetType,
          filePath: newFilePath,
          fileName: path.basename(newFilePath),
          fileSize: stats.size,
          mimeType: foundResource.mimeType,
          metadata: { ...foundResource.metadata },
          createdAt: new Date().toISOString(),
        };

        return { success: true, data: newResource };
      } catch (error) {
        console.error('[Resource] Copy failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to copy resource',
        };
      }
    }
  );

  // Reorder resources (rename files to change order)
  ipcMain.handle(
    RESOURCE_CHANNELS.REORDER,
    async (_, request: ResourceReorderRequest): Promise<OperationResult<Resource[]>> => {
      console.log('[Resource] REORDER request:', JSON.stringify(request, null, 2));
      try {
        // Verify draft exists
        const draft = await storage.draft.get(request.draftId);
        if (!draft) {
          console.log('[Resource] REORDER: Draft not found:', request.draftId);
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        console.log('[Resource] REORDER: Calling reorderResourceFiles...');
        // Reorder the resources by renaming files (只重命名，返回新 ID 列表)
        const newResourceIds = await storage.reorderResourceFiles(
          request.draftId,
          request.type,
          request.orderedIds
        );
        console.log('[Resource] REORDER: newResourceIds =', newResourceIds);

        // 使用缓存快速获取完整资源列表（缓存 key 已在 reorderResourceFiles 中更新）
        console.log('[Resource] REORDER: Scanning resources...');
        const updatedResources = await storage.scanResources(request.draftId, request.type);

        console.log('[Resource] REORDER SUCCESS:', updatedResources.length, 'resources of type', request.type);
        return { success: true, data: updatedResources };
      } catch (error) {
        console.error('[Resource] Reorder failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to reorder resources',
        };
      }
    }
  );

  // Delete resource
  ipcMain.handle(
    RESOURCE_CHANNELS.DELETE,
    async (_, request: ResourceDeleteRequest): Promise<OperationResult> => {
      try {
        // 直接删除文件，不需要先扫描资源（避免 ffprobe 占用文件）
        const deleted = await storage.resource.delete(request.draftId, request.id);
        if (!deleted) {
          return { success: false, error: 'Failed to delete resource' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete resource',
        };
      }
    }
  );

  // Open resource folder
  ipcMain.handle(
    RESOURCE_CHANNELS.OPEN_FOLDER,
    async (_, request: ResourceOpenFolderRequest): Promise<OperationResult> => {
      try {
        // Find the resource
        const drafts = await storage.draft.list();
        let foundResource: Resource | null = null;

        for (const draft of drafts) {
          const resource = await storage.resource.get(draft.id, request.id);
          if (resource) {
            foundResource = resource;
            break;
          }
        }

        if (!foundResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND' };
        }

        // Open the folder containing the file
        shell.showItemInFolder(foundResource.filePath);

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open folder',
        };
      }
    }
  );

  // Delete all split folders for a draft
  ipcMain.handle(
    RESOURCE_CHANNELS.DELETE_SPLIT_FOLDERS,
    async (_, request: { draftId: string }): Promise<OperationResult<number>> => {
      try {
        const filesDir = storage.getFilesPath(request.draftId);
        let deletedCount = 0;

        try {
          const entries = await fs.readdir(filesDir, { withFileTypes: true });

          for (const entry of entries) {
            // Find directories matching split_* pattern
            if (entry.isDirectory() && entry.name.startsWith('split_')) {
              const splitDir = path.join(filesDir, entry.name);
              try {
                await fs.rm(splitDir, { recursive: true, force: true });
                deletedCount++;
                console.log('[Resource] Deleted split folder:', splitDir);
              } catch (err) {
                console.error('[Resource] Failed to delete split folder:', splitDir, err);
              }
            }
          }
        } catch {
          // files directory may not exist, which is fine
        }

        return { success: true, data: deletedCount };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete split folders',
        };
      }
    }
  );

  // Save split points for a video
  ipcMain.handle(
    RESOURCE_CHANNELS.SAVE_SPLIT_POINTS,
    async (
      _,
      request: {
        draftId: string;
        videoId: string;
        duration: number;
        fps: number;
        splitPoints: Array<{
          id: string;
          time: number;
          frame: number;
          isAutoDetected: boolean;
        }>;
      }
    ): Promise<OperationResult> => {
      try {
        await storage.splitPoints.save(request.draftId, request.videoId, {
          videoId: request.videoId,
          duration: request.duration,
          fps: request.fps,
          splitPoints: request.splitPoints,
        });
        console.log('[Resource] Saved split points for video:', request.videoId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save split points',
        };
      }
    }
  );

  // Load split points for a video
  ipcMain.handle(
    RESOURCE_CHANNELS.LOAD_SPLIT_POINTS,
    async (
      _,
      request: { draftId: string; videoId: string }
    ): Promise<
      OperationResult<{
        videoId: string;
        duration: number;
        fps: number;
        splitPoints: Array<{
          id: string;
          time: number;
          frame: number;
          isAutoDetected: boolean;
        }>;
      }>
    > => {
      try {
        const data = await storage.splitPoints.load(request.draftId, request.videoId);
        if (data) {
          console.log('[Resource] Loaded split points for video:', request.videoId);
          return {
            success: true,
            data: {
              videoId: data.videoId,
              duration: data.duration,
              fps: data.fps,
              splitPoints: data.splitPoints,
            },
          };
        }
        return { success: true, data: undefined };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load split points',
        };
      }
    }
  );

  // Get thumbnail for a resource (cached or generated)
  ipcMain.handle(
    RESOURCE_CHANNELS.GET_THUMBNAIL,
    async (_, request: ResourceThumbnailRequest): Promise<OperationResult<string>> => {
      try {
        // Get the resource
        const resource = await storage.resource.get(request.draftId, request.resourceId);
        if (!resource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND' };
        }

        // Determine media type
        let mediaType: 'video' | 'image' | null = null;
        if (resource.mimeType.startsWith('video/')) {
          mediaType = 'video';
        } else if (resource.mimeType.startsWith('image/')) {
          mediaType = 'image';
        }

        if (!mediaType) {
          return { success: false, error: 'UNSUPPORTED_MEDIA_TYPE' };
        }

        // Get draft path
        const draftPath = storage.getDraftPath(request.draftId);

        // Get or generate thumbnail
        const thumbnailPath = await thumbnailCache.getOrGenerateThumbnail(
          draftPath,
          resource.filePath,
          mediaType
        );

        if (!thumbnailPath) {
          return { success: false, error: 'THUMBNAIL_GENERATION_FAILED' };
        }

        return { success: true, data: thumbnailPath };
      } catch (error) {
        console.error('[Resource] GET_THUMBNAIL error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get thumbnail',
        };
      }
    }
  );
}

export default registerResourceHandlers;
