/**
 * Section IPC Handlers
 * 管理动态卡片栏（section）的 CRUD 操作
 */
import { ipcMain } from 'electron';
import { SECTION_CHANNELS } from '@shared/ipc-channels';
import type { OperationResult, SectionDescriptor, MediaType } from '@shared/types';
import storage from '../services/storage';

interface SectionListRequest {
  draftId: string;
}

interface SectionCreateRequest {
  draftId: string;
  mediaType: MediaType;
  label: string;
}

interface SectionDeleteRequest {
  draftId: string;
  sectionId: string;
}

interface SectionRenameRequest {
  draftId: string;
  sectionId: string;
  newLabel: string;
}

interface SectionReorderRequest {
  draftId: string;
  orderedIds: string[];
}

export default function registerSectionHandlers(): void {
  // List sections
  ipcMain.handle(
    SECTION_CHANNELS.LIST,
    async (_, request: SectionListRequest): Promise<OperationResult<SectionDescriptor[]>> => {
      try {
        const sections = await storage.scanSections(request.draftId);
        return { success: true, data: sections };
      } catch (error) {
        console.error('[SectionIPC] Failed to list sections:', error);
        return { success: false, error: error instanceof Error ? error.message : 'SECTION_LIST_ERROR' };
      }
    }
  );

  // Create section
  ipcMain.handle(
    SECTION_CHANNELS.CREATE,
    async (_, request: SectionCreateRequest): Promise<OperationResult<SectionDescriptor>> => {
      try {
        const section = await storage.createSection(request.draftId, request.mediaType, request.label);
        return { success: true, data: section };
      } catch (error) {
        console.error('[SectionIPC] Failed to create section:', error);
        return { success: false, error: error instanceof Error ? error.message : 'SECTION_CREATE_ERROR' };
      }
    }
  );

  // Delete section
  ipcMain.handle(
    SECTION_CHANNELS.DELETE,
    async (_, request: SectionDeleteRequest): Promise<OperationResult> => {
      try {
        await storage.deleteSection(request.draftId, request.sectionId);
        return { success: true };
      } catch (error) {
        console.error('[SectionIPC] Failed to delete section:', error);
        return { success: false, error: error instanceof Error ? error.message : 'SECTION_DELETE_ERROR' };
      }
    }
  );

  // Rename section
  ipcMain.handle(
    SECTION_CHANNELS.RENAME,
    async (_, request: SectionRenameRequest): Promise<OperationResult<SectionDescriptor>> => {
      try {
        const section = await storage.renameSection(request.draftId, request.sectionId, request.newLabel);
        return { success: true, data: section };
      } catch (error) {
        console.error('[SectionIPC] Failed to rename section:', error);
        return { success: false, error: error instanceof Error ? error.message : 'SECTION_RENAME_ERROR' };
      }
    }
  );

  // Reorder sections
  ipcMain.handle(
    SECTION_CHANNELS.REORDER,
    async (_, request: SectionReorderRequest): Promise<OperationResult<SectionDescriptor[]>> => {
      try {
        const sections = await storage.reorderSections(request.draftId, request.orderedIds);
        return { success: true, data: sections };
      } catch (error) {
        console.error('[SectionIPC] Failed to reorder sections:', error);
        return { success: false, error: error instanceof Error ? error.message : 'SECTION_REORDER_ERROR' };
      }
    }
  );
}
