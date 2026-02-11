import { ipcMain } from 'electron';
import { DRAFT_CHANNELS, LINKS_CHANNELS, PROMPT_HISTORY_CHANNELS } from '@shared/ipc-channels';
import storage, { LinksFile, PromptHistoryFile } from '../services/storage';
import { checkAndMigrate } from '../services/migration';
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

interface DraftCopyRequest {
  id: string;
  count: number;  // 复制份数
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

  // Copy draft
  ipcMain.handle(
    DRAFT_CHANNELS.COPY,
    async (_, request: DraftCopyRequest): Promise<OperationResult<Draft[]>> => {
      try {
        const existing = await storage.draft.get(request.id);
        if (!existing) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        if (request.count < 1 || request.count > 20) {
          return { success: false, error: 'Copy count must be between 1 and 20' };
        }

        // 获取所有草稿，找出已存在的同名后缀数字
        const allDrafts = await storage.draft.list();
        const baseName = existing.name;
        const existingNames = new Set(allDrafts.map(d => d.name));

        // 找出所有 baseName-数字 格式的草稿中最大的数字
        const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
        let maxNumber = 0;
        for (const draft of allDrafts) {
          const match = draft.name.match(pattern);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) {
              maxNumber = num;
            }
          }
        }

        // 从 maxNumber + 1 开始编号，跳过已存在的名称
        const copiedDrafts: Draft[] = [];
        let nextNumber = maxNumber + 1;
        for (let i = 0; i < request.count; i++) {
          // 找到下一个不重复的名称
          let newName = `${baseName}-${nextNumber}`;
          while (existingNames.has(newName)) {
            nextNumber++;
            newName = `${baseName}-${nextNumber}`;
          }
          existingNames.add(newName); // 防止本次复制中重复

          const newDraft = await storage.draft.copy(request.id, newName);
          copiedDrafts.push(newDraft);
          nextNumber++;
        }

        return { success: true, data: copiedDrafts };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to copy draft',
        };
      }
    }
  );

  // 选择草稿时执行数据迁移（如果需要）
  ipcMain.handle(
    DRAFT_CHANNELS.CLEANUP_FILES,
    async (_, request: { draftId: string }): Promise<OperationResult<number>> => {
      try {
        const existing = await storage.draft.get(request.draftId);
        if (!existing) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        // 检查并执行数据迁移（如果需要）
        const draftPath = storage.getDraftPath(request.draftId);
        await checkAndMigrate(draftPath);

        return { success: true, data: 0 };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to migrate draft',
        };
      }
    }
  );

  // ============================================
  // Links IPC Handlers (分镜关联关系)
  // ============================================

  // Load links
  ipcMain.handle(
    LINKS_CHANNELS.LOAD,
    async (_, request: { draftId: string }): Promise<OperationResult<LinksFile>> => {
      try {
        const existing = await storage.draft.get(request.draftId);
        if (!existing) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        const links = await storage.links.load(request.draftId);
        return { success: true, data: links };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load links',
        };
      }
    }
  );

  // Save links
  ipcMain.handle(
    LINKS_CHANNELS.SAVE,
    async (_, request: { draftId: string; links: LinksFile }): Promise<OperationResult> => {
      try {
        const existing = await storage.draft.get(request.draftId);
        if (!existing) {
          return { success: false, error: 'DRAFT_NOT_FOUND' };
        }

        await storage.links.save(request.draftId, request.links);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save links',
        };
      }
    }
  );

  // ============================================
  // Prompt History IPC Handlers (提示词历史)
  // ============================================

  ipcMain.handle(
    PROMPT_HISTORY_CHANNELS.LOAD,
    async (_, request: { draftId: string }): Promise<OperationResult<PromptHistoryFile>> => {
      try {
        const history = await storage.promptHistory.load(request.draftId);
        return { success: true, data: history };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load prompt history',
        };
      }
    }
  );

  ipcMain.handle(
    PROMPT_HISTORY_CHANNELS.SAVE,
    async (_, request: { draftId: string; prompt: string }): Promise<OperationResult<PromptHistoryFile>> => {
      try {
        const history = await storage.promptHistory.save(request.draftId, request.prompt);
        return { success: true, data: history };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save prompt history',
        };
      }
    }
  );

  ipcMain.handle(
    PROMPT_HISTORY_CHANNELS.REMOVE,
    async (_, request: { draftId: string; prompt: string }): Promise<OperationResult<PromptHistoryFile>> => {
      try {
        const history = await storage.promptHistory.remove(request.draftId, request.prompt);
        return { success: true, data: history };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove prompt history',
        };
      }
    }
  );
}

export default registerDraftHandlers;
