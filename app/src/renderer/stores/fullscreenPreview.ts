import { create } from 'zustand';

// 全屏预览类型
export type FullscreenPreviewType = 'image' | 'video' | null;

interface FullscreenPreviewState {
  // 当前全屏显示的资源 ID
  resourceId: string | null;

  // 当前全屏类型
  previewType: FullscreenPreviewType;

  // 资源类型（用于左右切换时获取同类型资源）
  resourceType: string | null;

  // 打开全屏预览
  openFullscreen: (resourceId: string, previewType: 'image' | 'video', resourceType: string) => void;

  // 关闭全屏预览
  closeFullscreen: () => void;

  // 切换到指定资源（保持全屏状态）
  switchToResource: (resourceId: string) => void;
}

export const useFullscreenPreviewStore = create<FullscreenPreviewState>((set) => ({
  resourceId: null,
  previewType: null,
  resourceType: null,

  openFullscreen: (resourceId: string, previewType: 'image' | 'video', resourceType: string) => {
    set({
      resourceId,
      previewType,
      resourceType,
    });
  },

  closeFullscreen: () => {
    set({
      resourceId: null,
      previewType: null,
      resourceType: null,
    });
  },

  switchToResource: (resourceId: string) => {
    set({ resourceId });
  },
}));

export default useFullscreenPreviewStore;
