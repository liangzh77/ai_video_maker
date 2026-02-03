/**
 * Section Order Store
 * 管理资源面板中各个分组的显示顺序
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ResourceType } from '@shared/types';

// 定义所有可用的 section 类型
export const ALL_SECTION_TYPES: ResourceType[] = [
  'source_video',
  'source_character',
  'prompt',
  'new_character',
  'scene_source',
  'scene_new',
  'scene_hd',
  'lipsync',
  'synthesized',
];

// Section 配置（标题、接受的文件格式等）
export interface SectionConfig {
  type: ResourceType;
  title: string;
  acceptFormats?: string[];
  isText?: boolean;
}

export const SECTION_CONFIGS: Record<ResourceType, SectionConfig> = {
  source_video: {
    type: 'source_video',
    title: '源视频',
    acceptFormats: ['video/*'],
  },
  source_character: {
    type: 'source_character',
    title: '源角色图片',
    acceptFormats: ['image/*'],
  },
  prompt: {
    type: 'prompt',
    title: '提示词',
    acceptFormats: ['text/*', '.txt', '.md'],
    isText: true,
  },
  new_character: {
    type: 'new_character',
    title: '新角色图片',
    acceptFormats: ['image/*'],
  },
  scene_source: {
    type: 'scene_source',
    title: '分镜源视频',
  },
  scene_new: {
    type: 'scene_new',
    title: '分镜新视频',
    acceptFormats: ['video/*'],
  },
  scene_hd: {
    type: 'scene_hd',
    title: '高清分镜新视频',
    acceptFormats: ['video/*'],
  },
  lipsync: {
    type: 'lipsync',
    title: '对口型新视频',
    acceptFormats: ['video/*'],
  },
  synthesized: {
    type: 'synthesized',
    title: '合成新视频',
    acceptFormats: ['video/*'],
  },
};

interface SectionOrderState {
  // Section 顺序（ResourceType 数组）
  order: ResourceType[];

  // 设置完整顺序
  setOrder: (order: ResourceType[]) => void;

  // 移动 section 到指定位置
  moveSection: (fromType: ResourceType, toType: ResourceType) => void;

  // 移动 section 到末尾
  moveSectionToEnd: (type: ResourceType) => void;

  // 重置为默认顺序
  resetOrder: () => void;
}

export const useSectionOrderStore = create<SectionOrderState>()(
  persist(
    (set, get) => ({
      order: [...ALL_SECTION_TYPES],

      setOrder: (order) => {
        set({ order });
      },

      moveSection: (fromType, toType) => {
        const { order } = get();
        const fromIndex = order.indexOf(fromType);
        const toIndex = order.indexOf(toType);

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

        const newOrder = [...order];
        // 移除原位置
        newOrder.splice(fromIndex, 1);
        // 插入到目标位置
        const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        newOrder.splice(insertIndex, 0, fromType);

        set({ order: newOrder });
      },

      moveSectionToEnd: (type) => {
        const { order } = get();
        const currentIndex = order.indexOf(type);

        if (currentIndex === -1 || currentIndex === order.length - 1) return;

        const newOrder = [...order];
        newOrder.splice(currentIndex, 1);
        newOrder.push(type);

        set({ order: newOrder });
      },

      resetOrder: () => {
        set({ order: [...ALL_SECTION_TYPES] });
      },
    }),
    {
      name: 'section-order-storage',
    }
  )
);

export default useSectionOrderStore;
