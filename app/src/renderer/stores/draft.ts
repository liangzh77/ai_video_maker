import { create } from 'zustand';
import type { Draft, Resource, ResourceType, OperationResult } from '@shared/types';

// ============================================
// Types
// ============================================

interface DraftState {
  // State
  drafts: Draft[];
  selectedDraftId: string | null;
  resources: Resource[];
  selectedResourceId: string | null;
  isLoading: boolean;
  error: string | null;

  // Draft Actions
  loadDrafts: () => Promise<void>;
  selectDraft: (id: string | null) => Promise<void>;
  createDraft: (name: string) => Promise<Draft | null>;
  updateDraft: (id: string, name: string) => Promise<Draft | null>;
  deleteDraft: (id: string) => Promise<boolean>;

  // Resource Actions
  loadResources: (draftId: string) => Promise<void>;
  selectResource: (id: string | null) => void;
  addResource: (draftId: string, type: ResourceType, filePath: string) => Promise<Resource | null>;
  addFrameAsResource: (draftId: string, type: ResourceType, imageData: string, fileName: string) => Promise<Resource | null>;
  addTextResource: (draftId: string, type: ResourceType, content: string) => Promise<Resource | null>;
  updateResource: (id: string, metadata: Partial<Resource['metadata']>) => Promise<Resource | null>;
  deleteResource: (id: string) => Promise<boolean>;
  openResourceFolder: (id: string) => Promise<void>;

  // Computed
  getSelectedDraft: () => Draft | null;
  getSelectedResource: () => Resource | null;
  getResourcesByType: (type: ResourceType) => Resource[];
}

// ============================================
// Store Implementation
// ============================================

export const useDraftStore = create<DraftState>((set, get) => ({
  // Initial State
  drafts: [],
  selectedDraftId: null,
  resources: [],
  selectedResourceId: null,
  isLoading: false,
  error: null,

  // Draft Actions
  loadDrafts: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.draft.list({ page: 1, pageSize: 100 });
      set({ drafts: result.items || [], isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  selectDraft: async (id: string | null) => {
    set({ selectedDraftId: id, selectedResourceId: null, resources: [] });

    if (id) {
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
        set((state) => ({
          resources: [...state.resources, result.data!],
        }));
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
    return resources.filter((r) => r.type === type);
  },
}));

export default useDraftStore;
