import { create } from 'zustand';

/**
 * 分镜源视频和分镜新视频的关联关系 Store
 *
 * 关联逻辑：
 * - scene_source 和 scene_new 按索引一一对应
 * - 点击批量关联按钮时，按当前排序顺序重新建立关联
 * - 拖动调整顺序时，关联关系保持不变（基于资源 ID）
 */

// 支持拖动排序的资源类型
export const SORTABLE_TYPES = ['scene_source', 'scene_new'] as const;
export type SortableType = typeof SORTABLE_TYPES[number];

interface SceneLinkState {
  // 当前草稿 ID
  draftId: string | null;

  // 关联映射：scene_source ID -> scene_new ID
  sourceToNewMap: Map<string, string>;

  // 反向映射：scene_new ID -> scene_source ID
  newToSourceMap: Map<string, string>;

  // 自定义排序：类型 -> 资源 ID 数组（按显示顺序）
  customOrder: Map<SortableType, string[]>;

  // 设置当前草稿
  setDraftId: (draftId: string | null) => void;

  // 批量关联：按索引顺序关联 scene_source 和 scene_new
  batchLink: (sourceIds: string[], newIds: string[]) => void;

  // 获取关联的资源 ID
  getLinkedId: (resourceId: string, resourceType: 'scene_source' | 'scene_new') => string | null;

  // 清除所有关联
  clearLinks: () => void;

  // 设置自定义排序
  setCustomOrder: (type: SortableType, orderedIds: string[]) => void;

  // 获取自定义排序（如果存在）
  getCustomOrder: (type: SortableType) => string[] | null;

  // 清除自定义排序
  clearCustomOrder: (type?: SortableType) => void;

  // 交换两个资源的顺序
  swapOrder: (type: SortableType, fromId: string, toId: string) => void;
}

export const useSceneLinkStore = create<SceneLinkState>((set, get) => ({
  draftId: null,
  sourceToNewMap: new Map(),
  newToSourceMap: new Map(),
  customOrder: new Map(),

  setDraftId: (draftId: string | null) => {
    const currentDraftId = get().draftId;
    if (currentDraftId !== draftId) {
      // 切换草稿时清除关联和自定义排序
      set({
        draftId,
        sourceToNewMap: new Map(),
        newToSourceMap: new Map(),
        customOrder: new Map(),
      });
    }
  },

  batchLink: (sourceIds: string[], newIds: string[]) => {
    const sourceToNewMap = new Map<string, string>();
    const newToSourceMap = new Map<string, string>();

    // 按索引一一对应
    const count = Math.min(sourceIds.length, newIds.length);
    for (let i = 0; i < count; i++) {
      sourceToNewMap.set(sourceIds[i], newIds[i]);
      newToSourceMap.set(newIds[i], sourceIds[i]);
    }

    set({ sourceToNewMap, newToSourceMap });
  },

  getLinkedId: (resourceId: string, resourceType: 'scene_source' | 'scene_new') => {
    const { sourceToNewMap, newToSourceMap } = get();

    if (resourceType === 'scene_source') {
      return sourceToNewMap.get(resourceId) || null;
    } else {
      return newToSourceMap.get(resourceId) || null;
    }
  },

  clearLinks: () => {
    set({
      sourceToNewMap: new Map(),
      newToSourceMap: new Map(),
    });
  },

  setCustomOrder: (type: SortableType, orderedIds: string[]) => {
    const customOrder = new Map(get().customOrder);
    customOrder.set(type, [...orderedIds]);
    set({ customOrder });
  },

  getCustomOrder: (type: SortableType) => {
    const order = get().customOrder.get(type);
    return order ? [...order] : null;
  },

  clearCustomOrder: (type?: SortableType) => {
    if (type) {
      const customOrder = new Map(get().customOrder);
      customOrder.delete(type);
      set({ customOrder });
    } else {
      set({ customOrder: new Map() });
    }
  },

  swapOrder: (type: SortableType, fromId: string, toId: string) => {
    const { customOrder } = get();
    const currentOrder = customOrder.get(type);
    if (!currentOrder) return;

    const fromIndex = currentOrder.indexOf(fromId);
    const toIndex = currentOrder.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return;

    // 交换位置
    const newOrder = [...currentOrder];
    newOrder[fromIndex] = toId;
    newOrder[toIndex] = fromId;

    const newCustomOrder = new Map(customOrder);
    newCustomOrder.set(type, newOrder);
    set({ customOrder: newCustomOrder });
  },
}));

export default useSceneLinkStore;
