import { create } from 'zustand';

/**
 * 分镜源视频和分镜新视频的关联关系 Store
 *
 * 关联逻辑：
 * - scene_source 和 scene_new 按索引一一对应
 * - 点击批量关联按钮时，按当前排序顺序重新建立关联
 * - 拖动调整顺序时，关联关系保持不变（基于资源 ID）
 *
 * 持久化：
 * - 关联关系保存在 links.json 文件中
 * - 切换草稿时自动加载
 * - 修改关联时自动保存
 */

// 支持拖动排序的资源类型
export const SORTABLE_TYPES = ['scene_source', 'scene_new', 'scene_hd', 'lipsync'] as const;
export type SortableType = typeof SORTABLE_TYPES[number];

// Links 文件结构（与后端保持一致）
interface LinksFile {
  sourceToNew: Record<string, string>;
  customOrder: Record<string, string[]>;
}

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

  // 设置单个关联（用于手动关联）
  setLink: (sourceId: string, newId: string) => void;

  // 设置自定义排序
  setCustomOrder: (type: SortableType, orderedIds: string[]) => void;

  // 获取自定义排序（如果存在）
  getCustomOrder: (type: SortableType) => string[] | null;

  // 清除自定义排序
  clearCustomOrder: (type?: SortableType) => void;

  // 移动资源到目标位置前面
  moveOrder: (type: SortableType, fromId: string, toId: string) => void;

  // 移动资源到末尾
  moveToEnd: (type: SortableType, fromId: string) => void;

  // 从后端加载关联关系
  loadFromStorage: (draftId: string) => Promise<void>;

  // 保存关联关系到后端
  saveToStorage: () => Promise<void>;
}

export const useSceneLinkStore = create<SceneLinkState>((set, get) => ({
  draftId: null,
  sourceToNewMap: new Map(),
  newToSourceMap: new Map(),
  customOrder: new Map(),

  setDraftId: (draftId: string | null) => {
    const currentDraftId = get().draftId;
    if (currentDraftId !== draftId) {
      // 切换草稿时清除状态（实际数据由 loadFromStorage 加载）
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

    // 自动保存
    get().saveToStorage();
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

    // 自动保存
    get().saveToStorage();
  },

  setLink: (sourceId: string, newId: string) => {
    const { sourceToNewMap, newToSourceMap } = get();

    // 创建新的 Map
    const newSourceToNewMap = new Map(sourceToNewMap);
    const newNewToSourceMap = new Map(newToSourceMap);

    // 先清除旧的关联
    // 如果 sourceId 之前有关联，清除旧的 newId 的反向映射
    const oldNewId = newSourceToNewMap.get(sourceId);
    if (oldNewId) {
      newNewToSourceMap.delete(oldNewId);
    }
    // 如果 newId 之前有关联，清除旧的 sourceId 的正向映射
    const oldSourceId = newNewToSourceMap.get(newId);
    if (oldSourceId) {
      newSourceToNewMap.delete(oldSourceId);
    }

    // 设置新的关联
    newSourceToNewMap.set(sourceId, newId);
    newNewToSourceMap.set(newId, sourceId);

    set({
      sourceToNewMap: newSourceToNewMap,
      newToSourceMap: newNewToSourceMap,
    });

    // 自动保存
    get().saveToStorage();
  },

  setCustomOrder: (type: SortableType, orderedIds: string[]) => {
    const customOrder = new Map(get().customOrder);
    customOrder.set(type, [...orderedIds]);
    set({ customOrder });

    // 自动保存
    get().saveToStorage();
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

    // 自动保存
    get().saveToStorage();
  },

  moveOrder: (type: SortableType, fromId: string, toId: string) => {
    const { customOrder } = get();
    const currentOrder = customOrder.get(type);
    if (!currentOrder) return;

    const fromIndex = currentOrder.indexOf(fromId);
    const toIndex = currentOrder.indexOf(toId);
    if (fromIndex === -1 || toIndex === -1) return;

    // 移动到目标位置前面：先移除，再插入
    const newOrder = [...currentOrder];
    newOrder.splice(fromIndex, 1); // 移除被拖拽的元素

    // 计算插入位置：如果原位置在目标前面，目标索引需要减1
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    newOrder.splice(insertIndex, 0, fromId); // 插入到目标位置前面

    const newCustomOrder = new Map(customOrder);
    newCustomOrder.set(type, newOrder);
    set({ customOrder: newCustomOrder });

    // 自动保存
    get().saveToStorage();
  },

  moveToEnd: (type: SortableType, fromId: string) => {
    const { customOrder } = get();
    const currentOrder = customOrder.get(type);
    if (!currentOrder) return;

    const fromIndex = currentOrder.indexOf(fromId);
    if (fromIndex === -1) return;

    // 已经在末尾，不需要移动
    if (fromIndex === currentOrder.length - 1) return;

    // 移动到末尾：先移除，再添加到末尾
    const newOrder = [...currentOrder];
    newOrder.splice(fromIndex, 1);
    newOrder.push(fromId);

    const newCustomOrder = new Map(customOrder);
    newCustomOrder.set(type, newOrder);
    set({ customOrder: newCustomOrder });

    // 自动保存
    get().saveToStorage();
  },

  // 从后端加载关联关系
  loadFromStorage: async (draftId: string) => {
    try {
      const result = await window.api.links.load({ draftId });
      if (result.success && result.data) {
        const data = result.data as LinksFile;

        // 转换 sourceToNew 对象为 Map
        const sourceToNewMap = new Map<string, string>();
        const newToSourceMap = new Map<string, string>();
        for (const [sourceId, newId] of Object.entries(data.sourceToNew)) {
          sourceToNewMap.set(sourceId, newId);
          newToSourceMap.set(newId, sourceId);
        }

        // 转换 customOrder 对象为 Map
        const customOrder = new Map<SortableType, string[]>();
        for (const [type, ids] of Object.entries(data.customOrder)) {
          if (SORTABLE_TYPES.includes(type as SortableType)) {
            customOrder.set(type as SortableType, ids);
          }
        }

        set({
          draftId,
          sourceToNewMap,
          newToSourceMap,
          customOrder,
        });

        console.log('[SceneLink] Loaded from storage:', {
          links: sourceToNewMap.size,
          customOrders: customOrder.size,
        });
      }
    } catch (error) {
      console.error('[SceneLink] Failed to load from storage:', error);
    }
  },

  // 保存关联关系到后端
  saveToStorage: async () => {
    const { draftId, sourceToNewMap, customOrder } = get();
    if (!draftId) return;

    try {
      // 转换 Map 为对象
      const sourceToNew: Record<string, string> = {};
      for (const [sourceId, newId] of sourceToNewMap.entries()) {
        sourceToNew[sourceId] = newId;
      }

      const customOrderObj: Record<string, string[]> = {};
      for (const [type, ids] of customOrder.entries()) {
        customOrderObj[type] = ids;
      }

      const links: LinksFile = {
        sourceToNew,
        customOrder: customOrderObj,
      };

      await window.api.links.save({ draftId, links });
      console.log('[SceneLink] Saved to storage');
    } catch (error) {
      console.error('[SceneLink] Failed to save to storage:', error);
    }
  },
}));

export default useSceneLinkStore;
