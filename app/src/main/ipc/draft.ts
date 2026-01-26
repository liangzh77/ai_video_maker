import { ipcMain } from 'electron';
import { DRAFT_CHANNELS } from '@shared/ipc-channels';
import storage from '../services/storage';
import type { Draft, OperationResult, PaginatedResult } from '@shared/types';

// ============================================
// Request Types
// ============================================

interface DraftListRequest {
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

interface DraftGetRequest {
  id: string;
}

interface DraftCreateRequest {
  name: string;
}

interface DraftUpdateRequest {
  id: string;
  name?: string;
}

interface DraftDeleteRequest {
  id: string;
}

// ============================================
// IPC Handlers
// ============================================

export function registerDraftHandlers(): void {
  // List drafts
  ipcMain.handle(
    DRAFT_CHANNELS.LIST,
    async (_, request: DraftListRequest = {}): Promise<PaginatedResult<Draft>> => {
      const { page = 1, pageSize = 50, sortBy = 'updatedAt', sortOrder = 'desc' } = request;

      let drafts = await storage.draft.list();

      // Sort
      drafts.sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortOrder === 'desc' ? -comparison : comparison;
      });

      // Paginate
      const total = drafts.length;
      const start = (page - 1) * pageSize;
      const items = drafts.slice(start, start + pageSize);

      return {
        items,
        total,
        page,
        pageSize,
      };
    }
  );

  // Get single draft
  ipcMain.handle(
    DRAFT_CHANNELS.GET,
    async (_, request: DraftGetRequest): Promise<Draft | null> => {
      return storage.draft.get(request.id);
    }
  );

  // Create draft
  ipcMain.handle(
    DRAFT_CHANNELS.CREATE,
    async (_, request: DraftCreateRequest): Promise<OperationResult<Draft>> => {
      try {
        if (!request.name || request.name.trim().length === 0) {
          return { success: false, error: 'Draft name is required' };
        }

        if (request.name.length > 100) {
          return { success: false, error: 'Draft name must be 100 characters or less' };
        }

        const draft = await storage.draft.create(request.name.trim());
        return { success: true, data: draft };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create draft',
        };
      }
    }
  );

  // Update draft
  ipcMain.handle(
    DRAFT_CHANNELS.UPDATE,
    async (_, request: DraftUpdateRequest): Promise<OperationResult<Draft>> => {
      try {
        const existing = await storage.draft.get(request.id);
        if (!existing) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        const updates: Partial<Draft> = {};
        if (request.name !== undefined) {
          if (request.name.trim().length === 0) {
            return { success: false, error: 'Draft name cannot be empty' };
          }
          if (request.name.length > 100) {
            return { success: false, error: 'Draft name must be 100 characters or less' };
          }
          updates.name = request.name.trim();
        }

        const draft = await storage.draft.update(request.id, updates);
        if (!draft) {
          return { success: false, error: 'Failed to update draft' };
        }

        return { success: true, data: draft };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update draft',
        };
      }
    }
  );

  // Delete draft
  ipcMain.handle(
    DRAFT_CHANNELS.DELETE,
    async (_, request: DraftDeleteRequest): Promise<OperationResult> => {
      try {
        const existing = await storage.draft.get(request.id);
        if (!existing) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        const deleted = await storage.draft.delete(request.id);
        if (!deleted) {
          return { success: false, error: 'Failed to delete draft' };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete draft',
        };
      }
    }
  );
}

export default registerDraftHandlers;
