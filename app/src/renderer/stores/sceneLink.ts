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
 *
 * 注意：排序功能已迁移到文件名序号实现，不再使用 customOrder
 */

// Links 文件结构（与后端保持一致）
interface LinksFile {
  sourceToNew: Record<string, string>;
}

interface SceneLinkState {
  // 当前草稿 ID
  draftId: string | null;

  // 关联映射：scene_source ID -> scene_new ID
  sourceToNewMap: Map<string, string>;

  // 反向映射：scene_new ID -> scene_source ID
  newToSourceMap: Map<string, string>;

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

  // 从后端加载关联关系
  loadFromStorage: (draftId: string) => Promise<void>;

  // 保存关联关系到后端
  saveToStorage: () => Promise<void>;
}

export const useSceneLinkStore = create<SceneLinkState>((set, get) => ({
  draftId: null,
  sourceToNewMap: new Map(),
  newToSourceMap: new Map(),

  setDraftId: (draftId: string | null) => {
    const currentDraftId = get().draftId;
    if (currentDraftId !== draftId) {
      // 切换草稿时清除状态（实际数据由 loadFromStorage 加载）
      set({
        draftId,
        sourceToNewMap: new Map(),
        newToSourceMap: new Map(),
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

        set({
          draftId,
          sourceToNewMap,
          newToSourceMap,
        });

        console.log('[SceneLink] Loaded from storage:', {
          links: sourceToNewMap.size,
        });
      }
    } catch (error) {
      console.error('[SceneLink] Failed to load from storage:', error);
    }
  },

  // 保存关联关系到后端
  saveToStorage: async () => {
    const { draftId, sourceToNewMap } = get();
    if (!draftId) return;

    try {
      // 转换 Map 为对象
      const sourceToNew: Record<string, string> = {};
      for (const [sourceId, newId] of sourceToNewMap.entries()) {
        sourceToNew[sourceId] = newId;
      }

      const links: LinksFile = {
        sourceToNew,
      };

      await window.api.links.save({ draftId, links });
      console.log('[SceneLink] Saved to storage');
    } catch (error) {
      console.error('[SceneLink] Failed to save to storage:', error);
    }
  },
}));

export default useSceneLinkStore;
