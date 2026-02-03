import { create } from 'zustand';
import type { Draft, Resource, ResourceType, OperationResult } from '@shared/types';

// ============================================
// Types
// ============================================

export type DraftSortBy = 'name' | 'updatedAt';
export type DraftSortOrder = 'asc' | 'desc';

// 从 localStorage 读取排序设置
const SORT_STORAGE_KEY = 'draft-sort-preference';
function loadSortPreference(): { sortBy: DraftSortBy; sortOrder: DraftSortOrder } {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // ignore
  }
  return { sortBy: 'updatedAt', sortOrder: 'desc' };
}

function saveSortPreference(sortBy: DraftSortBy, sortOrder: DraftSortOrder): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sortBy, sortOrder }));
  } catch {
    // ignore
  }
}

interface DraftState {
  // State
  drafts: Draft[];
  selectedDraftId: string | null;
  resources: Resource[];
  selectedResourceId: string | null;
  isLoading: boolean;
  error: string | null;
  sortBy: DraftSortBy;
  sortOrder: DraftSortOrder;

  // Draft Actions
  loadDrafts: () => Promise<void>;
  selectDraft: (id: string | null) => Promise<void>;
  createDraft: (name: string) => Promise<Draft | null>;
  updateDraft: (id: string, name: string) => Promise<Draft | null>;
  deleteDraft: (id: string) => Promise<boolean>;
  copyDraft: (id: string, count: number) => Promise<Draft[] | null>;
  setSortBy: (sortBy: DraftSortBy) => Promise<void>;

  // Resource Actions
  loadResources: (draftId: string) => Promise<void>;
  selectResource: (id: string | null) => void;
  addResource: (draftId: string, type: ResourceType, filePath: string) => Promise<Resource | null>;
  addFrameAsResource: (draftId: string, type: ResourceType, imageData: string, fileName: string) => Promise<Resource | null>;
  addTextResource: (draftId: string, type: ResourceType, content: string) => Promise<Resource | null>;
  updateResource: (id: string, metadata: Partial<Resource['metadata']>) => Promise<Resource | null>;
  deleteResource: (id: string) => Promise<boolean>;
  deleteResourcesByType: (type: ResourceType) => Promise<{ success: number; failed: number }>;
  openResourceFolder: (id: string) => Promise<void>;

  // Computed
  getSelectedDraft: () => Draft | null;
  getSelectedResource: () => Resource | null;
  getResourcesByType: (type: ResourceType) => Resource[];
}

// ============================================
// Store Implementation
// ============================================

const initialSort = loadSortPreference();

export const useDraftStore = create<DraftState>((set, get) => ({
  // Initial State
  drafts: [],
  selectedDraftId: null,
  resources: [],
  selectedResourceId: null,
  isLoading: false,
  error: null,
  sortBy: initialSort.sortBy,
  sortOrder: initialSort.sortOrder,

  // Draft Actions
  loadDrafts: async () => {
    const { sortBy, sortOrder } = get();
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.draft.list({ page: 1, pageSize: 100, sortBy, sortOrder });
      set({ drafts: result.items || [], isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  setSortBy: async (newSortBy: DraftSortBy) => {
    const { sortBy: currentSortBy, sortOrder: currentSortOrder } = get();
    let newSortOrder: DraftSortOrder;

    if (newSortBy === currentSortBy) {
      // 点击同一排序方式，切换顺序
      newSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      // 切换排序方式，使用默认顺序
      newSortOrder = newSortBy === 'name' ? 'asc' : 'desc';
    }

    set({ sortBy: newSortBy, sortOrder: newSortOrder });
    saveSortPreference(newSortBy, newSortOrder);
    await get().loadDrafts();
  },

  selectDraft: async (id: string | null) => {
    set({ selectedDraftId: id, selectedResourceId: null, resources: [] });

    if (id) {
      // 清理未被引用的文件
      try {
        const cleanupResult = await window.api.draft.cleanupFiles({ draftId: id });
        if (cleanupResult.success && cleanupResult.data > 0) {
          console.log(`[Draft] Cleaned up ${cleanupResult.data} orphaned files`);
        }
      } catch (err) {
        console.error('[Draft] Failed to cleanup orphaned files:', err);
      }

      await get().loadResources(id);
    }
  },

  createDraft: async (name: string) => {
    set({ isLoading: true, error: null });
    try {
      const result: OperationResult<Draft> = await window.api.draft.create({ name });
      if (result.success && result.data) {
        set((state) => ({
          drafts: [result.data!, ...state.drafts],
          isLoading: false,
        }));
        return result.data;
      } else {
        set({ error: result.error || 'Failed to create draft', isLoading: false });
        return null;
      }
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      return null;
    }
  },

  updateDraft: async (id: string, name: string) => {
    try {
      const result: OperationResult<Draft> = await window.api.draft.update({ id, name });
      if (result.success && result.data) {
        set((state) => ({
          drafts: state.drafts.map((d) => (d.id === id ? result.data! : d)),
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  deleteDraft: async (id: string) => {
    try {
      const result: OperationResult = await window.api.draft.delete({ id });
      if (result.success) {
        set((state) => ({
          drafts: state.drafts.filter((d) => d.id !== id),
          selectedDraftId: state.selectedDraftId === id ? null : state.selectedDraftId,
          resources: state.selectedDraftId === id ? [] : state.resources,
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  copyDraft: async (id: string, count: number) => {
    try {
      const result: OperationResult<Draft[]> = await window.api.draft.copy({ id, count });
      if (result.success && result.data) {
        // 将新复制的草稿添加到列表开头
        set((state) => ({
          drafts: [...result.data!, ...state.drafts],
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  // Resource Actions
  loadResources: async (draftId: string) => {
    set({ isLoading: true, error: null });
    try {
      const resources = await window.api.resource.list({ draftId });
      set({ resources: resources || [], isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  selectResource: (id: string | null) => {
    set({ selectedResourceId: id });
  },

  addResource: async (draftId: string, type: ResourceType, filePath: string) => {
    try {
      const result: OperationResult<Resource> = await window.api.resource.add({
        draftId,
        type,
        filePath,
      });
      if (result.success && result.data) {
        const newResource = result.data;
        set((state) => {
          // 检查是否已存在相同 ID 的资源（覆盖场景）
          const existingIndex = state.resources.findIndex((r) => r.id === newResource.id);
          if (existingIndex >= 0) {
            // 更新现有资源
            const updatedResources = [...state.resources];
            updatedResources[existingIndex] = newResource;
            return { resources: updatedResources };
          }
          // 添加新资源
          return { resources: [...state.resources, newResource] };
        });
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  addFrameAsResource: async (draftId: string, type: ResourceType, imageData: string, fileName: string) => {
    try {
      console.log('addFrameAsResource called:', { draftId, type, fileName, imageDataLength: imageData.length });
      const result: OperationResult<Resource> = await window.api.resource.addFrame({
        draftId,
        type,
        imageData,
        fileName,
      });
      console.log('addFrameAsResource result:', result);
      if (result.success && result.data) {
        set((state) => ({
          resources: [...state.resources, result.data!],
        }));
        return result.data;
      }
      console.error('addFrameAsResource failed:', result.error);
      return null;
    } catch (error) {
      console.error('addFrameAsResource exception:', error);
      return null;
    }
  },

  addTextResource: async (draftId: string, type: ResourceType, content: string) => {
    console.log('=== store.addTextResource START ===');
    console.log('store.addTextResource params:', { draftId, type, contentLength: content.length });
    try {
      console.log('store.addTextResource: Calling window.api.resource.addText...');
      const result: OperationResult<Resource> = await window.api.resource.addText({
        draftId,
        type,
        content,
      });
      console.log('store.addTextResource IPC result:', result);
      if (result.success && result.data) {
        console.log('store.addTextResource: Updating state with new resource:', result.data.id);
        set((state) => ({
          resources: [...state.resources, result.data!],
        }));
        console.log('=== store.addTextResource SUCCESS ===');
        return result.data;
      }
      console.error('store.addTextResource: IPC returned failure:', result.error);
      return null;
    } catch (error) {
      console.error('store.addTextResource exception:', error);
      return null;
    }
  },

  updateResource: async (id: string, metadata: Partial<Resource['metadata']>) => {
    try {
      const result: OperationResult<Resource> = await window.api.resource.update({
        id,
        metadata,
      });
      if (result.success && result.data) {
        set((state) => ({
          resources: state.resources.map((r) => (r.id === id ? result.data! : r)),
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  deleteResource: async (id: string) => {
    try {
      const result: OperationResult = await window.api.resource.delete({ id });
      if (result.success) {
        set((state) => ({
          resources: state.resources.filter((r) => r.id !== id),
          selectedResourceId: state.selectedResourceId === id ? null : state.selectedResourceId,
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  deleteResourcesByType: async (type: ResourceType) => {
    const { resources, selectedDraftId } = get();
    const toDelete = resources.filter((r) => r.type === type);

    if (toDelete.length === 0) {
      return { success: 0, failed: 0 };
    }

    const deleteIds = toDelete.map((r) => r.id);
    const currentSelectedId = get().selectedResourceId;
    const wasSelectedDeleted = deleteIds.includes(currentSelectedId || '');

    // If deleting scene_source and current selection was deleted, select source_video to keep split points visible
    let newSelectedId: string | null = wasSelectedDeleted ? null : currentSelectedId;
    if (type === 'scene_source' && wasSelectedDeleted) {
      const sourceVideo = resources.find((r) => r.type === 'source_video');
      if (sourceVideo) {
        newSelectedId = sourceVideo.id;
      }
    }

    // Step 1: Update UI first to unmount components and release file locks
    set((state) => ({
      resources: state.resources.filter((r) => r.type !== type),
      selectedResourceId: newSelectedId,
    }));

    // Step 2: Wait for components to unmount and release file locks
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 3: Now delete files from disk
    let successCount = 0;
    let failedCount = 0;

    for (const resource of toDelete) {
      try {
        const result: OperationResult = await window.api.resource.delete({ id: resource.id });
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
    }

    // Step 4: If deleting scene_source, also delete split folders
    if (type === 'scene_source' && selectedDraftId) {
      try {
        await window.api.resource.deleteSplitFolders({ draftId: selectedDraftId });
      } catch (err) {
        console.error('Failed to delete split folders:', err);
      }
    }

    // Reload resources to ensure sync with disk
    const { loadResources } = get();
    if (selectedDraftId) {
      await loadResources(selectedDraftId);
    }

    return { success: successCount, failed: failedCount };
  },

  openResourceFolder: async (id: string) => {
    try {
      await window.api.resource.openFolder({ id });
    } catch {
      // Silently fail
    }
  },

  // Computed
  getSelectedDraft: () => {
    const { drafts, selectedDraftId } = get();
    return drafts.find((d) => d.id === selectedDraftId) || null;
  },

  getSelectedResource: () => {
    const { resources, selectedResourceId } = get();
    return resources.find((r) => r.id === selectedResourceId) || null;
  },

  getResourcesByType: (type: ResourceType) => {
    const { resources } = get();
    const filtered = resources.filter((r) => r.type === type);

    // 某些类型按文件名排序
    const sortByNameTypes: ResourceType[] = ['scene_new', 'scene_hd', 'lipsync', 'scene_source'];
    if (sortByNameTypes.includes(type)) {
      return filtered.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true }));
    }

    return filtered;
  },
}));

export default useDraftStore;
