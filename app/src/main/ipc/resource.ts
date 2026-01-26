import { ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { RESOURCE_CHANNELS } from '@shared/ipc-channels';
import storage from '../services/storage';
import { extractMetadata, getResourceTypeFromMime, getMimeType } from '../services/metadata';
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
  id: string;
}

interface ResourceOpenFolderRequest {
  id: string;
}

// ============================================
// Helper Functions
// ============================================

async function createResourceFromFile(
  draftId: string,
  type: ResourceType,
  sourcePath: string
): Promise<Resource> {
  // Verify source file exists
  const stats = await fs.stat(sourcePath);
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }

  const originalFileName = path.basename(sourcePath);
  const ext = path.extname(originalFileName);
  const mimeType = getMimeType(sourcePath);

  // Generate unique filename to avoid conflicts
  const uniqueId = uuidv4().slice(0, 8);
  const newFileName = `${path.basename(originalFileName, ext)}_${uniqueId}${ext}`;

  // Get destination path in draft's files directory
  const filesDir = storage.getFilesPath(draftId);
  await fs.mkdir(filesDir, { recursive: true });
  const destPath = path.join(filesDir, newFileName);

  // Copy file to storage
  await fs.copyFile(sourcePath, destPath);

  // Extract metadata from copied file
  const metadata = await extractMetadata(destPath, type);

  return await storage.resource.add(draftId, {
    type,
    filePath: destPath,
    fileName: originalFileName,
    fileSize: stats.size,
    mimeType,
    metadata,
  });
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

  // Update resource
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

        // Update the resource
        const updatedMetadata = request.metadata
          ? { ...foundResource.metadata, ...request.metadata }
          : foundResource.metadata;

        const updated = await storage.resource.update(foundDraftId, request.id, {
          metadata: updatedMetadata,
        });

        if (!updated) {
          return { success: false, error: 'Failed to update resource' };
        }

        return { success: true, data: updated };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update resource',
        };
      }
    }
  );

  // Delete resource
  ipcMain.handle(
    RESOURCE_CHANNELS.DELETE,
    async (_, request: ResourceDeleteRequest): Promise<OperationResult> => {
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

        if (!foundDraftId || !foundResource) {
          return { success: false, error: 'RESOURCE_NOT_FOUND' };
        }

        // Delete the file from storage if it exists in the files directory
        const filesDir = storage.getFilesPath(foundDraftId);
        if (foundResource.filePath.startsWith(filesDir)) {
          try {
            await fs.unlink(foundResource.filePath);
          } catch {
            // File may already be deleted, continue
          }
        }

        const deleted = await storage.resource.delete(foundDraftId, request.id);
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
}

export default registerResourceHandlers;
