import { create } from 'zustand';
import type { Draft, Resource, OperationResult } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { useSceneLinkStore } from './sceneLink';
import { useSectionsStore } from './sections';
import { usePlaybackStore } from './playback';
import { clearThumbnailCache } from '../components/ResourcePanel/ResourceCard';

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
  pendingGenerateResourceId: string | null;

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
  addResource: (draftId: string, sectionId: string, filePath: string) => Promise<Resource | null>;
  addFrameAsResource: (draftId: string, sectionId: string, imageData: string, fileName: string) => Promise<Resource | null>;
  addTextResource: (draftId: string, sectionId: string, content: string) => Promise<Resource | null>;
  updateResource: (id: string, metadata: Partial<Resource['metadata']>) => Promise<Resource | null>;
  deleteResource: (id: string) => Promise<boolean>;
  copyResource: (id: string, targetSectionId?: string) => Promise<Resource | null>;
  reorderResource: (sectionId: string, fromId: string, toId: string | null) => Promise<boolean>;
  deleteResourcesByType: (sectionId: string) => Promise<{ success: number; failed: number }>;
  clearLocalResourcesByType: (sectionId: string) => void;
  openResourceFolder: (id: string) => Promise<void>;
  setPendingGenerate: (id: string | null) => void;

  // Computed
  getSelectedDraft: () => Draft | null;
  getSelectedResource: () => Resource | null;
  getResourceById: (id: string) => Resource | null;
  getResourcesByType: (sectionId: string) => Resource[];
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
  pendingGenerateResourceId: null,

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
    // 不立即清空 resources，由 loadResources 原子替换，避免闪烁
    set({ selectedDraftId: id, selectedResourceId: null, ...(id ? {} : { resources: [] }) });

    if (id) {
      // 执行数据迁移（如果需要）
      try {
        await window.api.draft.cleanupFiles({ draftId: id });
      } catch (err) {
        console.error('[Draft] Failed to migrate draft:', err);
      }

      await get().loadResources(id);

      // 加载分镜关联关系
      await useSceneLinkStore.getState().loadFromStorage(id);
    } else {
      // 清空关联关系
      useSceneLinkStore.getState().setDraftId(null);
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
      const { selectedDraftId } = get();
      const isCurrentDraft = selectedDraftId === id;

      // 如果正在重命名当前选中的草稿，先释放资源以避免文件句柄占用
      if (isCurrentDraft) {
        // 停止所有播放
        usePlaybackStore.getState().stopPlaying(usePlaybackStore.getState().activePlayerType);

        // 清除资源状态，这会导致组件卸载并释放文件句柄
        set({ resources: [], selectedResourceId: null });

        // 清除缩略图缓存
        clearThumbnailCache();

        // 先取消选中草稿，强制卸载所有组件
        set({ selectedDraftId: null });

        // 等待足够时间让 React 组件卸载并释放文件句柄
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const result: OperationResult<Draft> = await window.api.draft.update({ id, name });
      if (result.success && result.data) {
        const updatedDraft = result.data;
        const newId = updatedDraft.id;
        const idChanged = newId !== id;

        set((state) => {
          const newDrafts = state.drafts.map((d) => (d.id === id ? updatedDraft : d));

          // 如果当前选中的草稿 ID 变了，更新选中状态
          const newSelectedId = state.selectedDraftId === id ? newId : state.selectedDraftId;

          return {
            drafts: newDrafts,
            selectedDraftId: newSelectedId,
          };
        });

        // 如果是当前草稿或 ID 变化了，需要重新加载资源
        if (isCurrentDraft || (idChanged && get().selectedDraftId === newId)) {
          await get().loadResources(newId);
          // 重新加载分镜关联关系
          await useSceneLinkStore.getState().loadFromStorage(newId);
        }

        return updatedDraft;
      }

      // 如果更新失败但之前清除了资源，需要恢复
      if (isCurrentDraft) {
        await get().loadResources(id);
        await useSceneLinkStore.getState().loadFromStorage(id);
      }

      return null;
    } catch {
      // 如果发生异常且清除了资源，尝试恢复
      const { selectedDraftId } = get();
      if (selectedDraftId === id) {
        try {
          await get().loadResources(id);
          await useSceneLinkStore.getState().loadFromStorage(id);
        } catch {
          // 忽略恢复失败
        }
      }
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
    // 不设置 isLoading，避免 DraftList 闪烁（isLoading 仅用于草稿列表加载）
    try {
      const resources = await window.api.resource.list({ draftId });
      set({ resources: resources || [], error: null });
      // 同时刷新 sections 列表（任务可能创建了新 section）
      useSectionsStore.getState().loadSections(draftId);
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  selectResource: (id: string | null) => {
    set({ selectedResourceId: id });
  },

  addResource: async (draftId: string, sectionId: string, filePath: string) => {
    try {
      const result: OperationResult<Resource> = await window.api.resource.add({
        draftId,
        type: sectionId,
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

  addFrameAsResource: async (draftId: string, sectionId: string, imageData: string, fileName: string) => {
    try {
      console.log('addFrameAsResource called:', { draftId, sectionId, fileName, imageDataLength: imageData.length });
      const result: OperationResult<Resource> = await window.api.resource.addFrame({
        draftId,
        type: sectionId,
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

  addTextResource: async (draftId: string, sectionId: string, content: string) => {
    console.log('=== store.addTextResource START ===');
    console.log('store.addTextResource params:', { draftId, sectionId, contentLength: content.length });
    try {
      console.log('store.addTextResource: Calling window.api.resource.addText...');
      const result: OperationResult<Resource> = await window.api.resource.addText({
        draftId,
        type: sectionId,
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
    const { selectedDraftId } = get();
    if (!selectedDraftId) return false;
    try {
      const result: OperationResult = await window.api.resource.delete({ draftId: selectedDraftId, id });
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

  copyResource: async (id: string, targetSectionId?: string) => {
    const { selectedDraftId } = get();
    try {
      const result: OperationResult<Resource> = await window.api.resource.copy({
        resourceId: id,
        targetType: targetSectionId,
        sourceDraftId: selectedDraftId || undefined, // 传递源草稿 ID，避免后端遍历
      });
      if (result.success && result.data) {
        set((state) => ({
          // 先过滤掉同 ID 的旧资源，再添加新资源，防止竞态导致的重复 ID
          resources: [...state.resources.filter(r => r.id !== result.data!.id), result.data!],
        }));
        return result.data;
      }
      console.warn('[DraftStore] copyResource 失败:', result.error);
      return null;
    } catch (err) {
      console.error('[DraftStore] copyResource exception:', err);
      return null;
    }
  },

  reorderResource: async (sectionId: string, fromId: string, toId: string | null) => {
    const { resources, selectedDraftId } = get();
    if (!selectedDraftId) return false;

    // 获取该 section 的所有资源，按当前文件名排序
    const sectionResources = resources
      .filter((r) => r.type === sectionId)
      .sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true }));

    const currentIds = sectionResources.map((r) => r.id);
    const fromIndex = currentIds.indexOf(fromId);
    if (fromIndex === -1) return false;

    // 构建新顺序
    const newOrder = [...currentIds];
    newOrder.splice(fromIndex, 1); // 先移除

    if (toId === null) {
      // 移动到末尾
      newOrder.push(fromId);
    } else {
      // 移动到目标位置前面
      const toIndex = newOrder.indexOf(toId);
      if (toIndex === -1) {
        newOrder.push(fromId);
      } else {
        newOrder.splice(toIndex, 0, fromId);
      }
    }

    try {
      const result: OperationResult<Resource[]> = await window.api.resource.reorder({
        draftId: selectedDraftId,
        type: sectionId,
        orderedIds: newOrder,
      });

      if (result.success && result.data) {
        // 清除该 section 资源的缩略图缓存（因为文件内容位置变了）
        if (result.data.length > 0) {
          const firstId = result.data[0].id;
          const slashIndex = firstId.indexOf('/');
          if (slashIndex > 0) {
            const folderPrefix = firstId.substring(0, slashIndex + 1);
            clearThumbnailCache(folderPrefix);
          }
        }

        // 重排序后资源 ID 会变化（因为文件名变了）
        set((state) => {
          const otherResources = state.resources.filter((r) => r.type !== sectionId);
          return {
            resources: [...otherResources, ...result.data!],
          };
        });

        // 重新加载关联关系（后端已更新了 关联.json 中的资源引用）
        await useSceneLinkStore.getState().loadFromStorage(selectedDraftId);

        return true;
      }
      return false;
    } catch (err) {
      console.error('[Draft] Reorder failed:', err);
      return false;
    }
  },

  deleteResourcesByType: async (sectionId: string) => {
    const { resources, selectedDraftId } = get();
    const toDelete = resources.filter((r) => r.type === sectionId);

    if (toDelete.length === 0) {
      return { success: 0, failed: 0 };
    }

    const deleteIds = toDelete.map((r) => r.id);
    const currentSelectedId = get().selectedResourceId;
    const wasSelectedDeleted = deleteIds.includes(currentSelectedId || '');
    const newSelectedId: string | null = wasSelectedDeleted ? null : currentSelectedId;

    // Step 1: 停止所有播放，释放视频句柄
    usePlaybackStore.getState().stopPlaying(usePlaybackStore.getState().activePlayerType);

    // Step 2: 清除缩略图缓存
    clearThumbnailCache();

    // Step 3: Update UI first to unmount components and release file locks
    set((state) => ({
      resources: state.resources.filter((r) => r.type !== sectionId),
      selectedResourceId: newSelectedId,
    }));

    // Step 4: Wait for components to unmount and release file locks
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Step 5: Now delete files from disk (同步逐个删除)
    let successCount = 0;
    let failedCount = 0;
    const failedFiles: string[] = [];

    for (const resource of toDelete) {
      try {
        const result: OperationResult = await window.api.resource.delete({ draftId: selectedDraftId, id: resource.id });
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
          failedFiles.push(resource.fileName);
        }
      } catch {
        failedCount++;
        failedFiles.push(resource.fileName);
      }
    }

    // Step 6: 检查是否为视频类型 section，如果是则也删除 split 文件夹
    const sectionDesc = parseFolderName(sectionId);
    if (sectionDesc?.mediaType === '视频' && selectedDraftId) {
      try {
        await window.api.resource.deleteSplitFolders({ draftId: selectedDraftId });
      } catch (err) {
        console.error('Failed to delete split folders:', err);
      }
    }

    // Step 7: Reload resources to ensure sync with disk
    const { loadResources } = get();
    if (selectedDraftId) {
      await loadResources(selectedDraftId);
    }

    // 如果有删除失败的文件，打印警告
    if (failedCount > 0) {
      console.warn('[Draft] Failed to delete files:', failedFiles);
    }

    return { success: successCount, failed: failedCount };
  },

  // 仅从前端状态中移除指定 section 的资源（不调用后端API）
  // 用于在后端异步任务开始时立即更新UI
  clearLocalResourcesByType: (sectionId: string) => {
    set((state) => ({
      resources: state.resources.filter((r) => r.type !== sectionId),
      selectedResourceId: state.resources.find((r) => r.id === state.selectedResourceId)?.type === sectionId
        ? null
        : state.selectedResourceId,
    }));
  },

  openResourceFolder: async (id: string) => {
    try {
      await window.api.resource.openFolder({ id });
    } catch {
      // Silently fail
    }
  },

  setPendingGenerate: (id: string | null) => {
    set({ pendingGenerateResourceId: id });
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

  getResourceById: (id: string) => {
    const { resources } = get();
    return resources.find((r) => r.id === id) || null;
  },

  getResourcesByType: (sectionId: string) => {
    const { resources } = get();
    const filtered = resources.filter((r) => r.type === sectionId);

    // 所有 section 都按文件名排序（序号在文件名开头）
    return filtered.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true }));
  },
}));

export default useDraftStore;
