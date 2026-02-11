/**
 * Sections Store
 * 管理动态卡片栏（section）的状态
 * 所有状态从文件系统读取，不需要 persist 中间件
 */
import { create } from 'zustand';
import type { SectionDescriptor, MediaType } from '@shared/types';

interface SectionsState {
  sections: SectionDescriptor[];

  // 加载（从后端扫描文件系统）
  loadSections: (draftId: string) => Promise<void>;

  // CRUD
  createSection: (draftId: string, mediaType: MediaType, label: string) => Promise<SectionDescriptor | null>;
  deleteSection: (draftId: string, sectionId: string) => Promise<boolean>;
  renameSection: (draftId: string, sectionId: string, newLabel: string) => Promise<boolean>;
  reorderSections: (draftId: string, orderedIds: string[]) => Promise<boolean>;

  // 查询
  getSectionById: (id: string) => SectionDescriptor | undefined;
  getSectionsByMediaType: (mediaType: MediaType) => SectionDescriptor[];
}

export const useSectionsStore = create<SectionsState>((set, get) => ({
  sections: [],

  loadSections: async (draftId: string) => {
    try {
      const result = await window.api.section.list({ draftId });
      if (result.success && result.data) {
        set({ sections: result.data });
      } else {
        console.error('[SectionsStore] Failed to load sections:', result.error);
        set({ sections: [] });
      }
    } catch (err) {
      console.error('[SectionsStore] loadSections error:', err);
      set({ sections: [] });
    }
  },

  createSection: async (draftId: string, mediaType: MediaType, label: string) => {
    try {
      const result = await window.api.section.create({ draftId, mediaType, label });
      if (result.success && result.data) {
        set((state) => ({
          sections: [...state.sections, result.data!].sort((a, b) => a.order - b.order),
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  deleteSection: async (draftId: string, sectionId: string) => {
    try {
      const result = await window.api.section.delete({ draftId, sectionId });
      if (result.success) {
        set((state) => ({
          sections: state.sections.filter((s) => s.id !== sectionId),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  renameSection: async (draftId: string, sectionId: string, newLabel: string) => {
    try {
      const result = await window.api.section.rename({ draftId, sectionId, newLabel });
      if (result.success && result.data) {
        const updated = result.data;
        set((state) => ({
          sections: state.sections.map((s) => (s.id === sectionId ? updated : s)),
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  reorderSections: async (draftId: string, orderedIds: string[]) => {
    try {
      const result = await window.api.section.reorder({ draftId, orderedIds });
      if (result.success && result.data) {
        set({ sections: result.data });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  getSectionById: (id: string) => {
    return get().sections.find((s) => s.id === id);
  },

  getSectionsByMediaType: (mediaType: MediaType) => {
    return get().sections.filter((s) => s.mediaType === mediaType);
  },
}));

export default useSectionsStore;
