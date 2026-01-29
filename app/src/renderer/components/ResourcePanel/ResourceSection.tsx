import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Empty, App, Popconfirm, Tooltip } from 'antd';
import { InboxOutlined, PlusOutlined, DeleteOutlined, LinkOutlined } from '@ant-design/icons';
import type { Resource, ResourceType } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useSceneLinkStore, SORTABLE_TYPES, type SortableType } from '../../stores/sceneLink';
import ResourceCard from './ResourceCard';
import PromptCard from './PromptCard';
import styles from './ResourceSection.module.css';

// Custom MIME type for frame data transfer (must match VideoPlayer)
const FRAME_DATA_MIME = 'application/x-video-frame';

interface ResourceSectionProps {
  title: string;
  type: ResourceType;
  resources: Resource[];
  acceptFormats?: string[];
  badge?: string;
  badgeType?: 'default' | 'success' | 'warning';
  isText?: boolean;
  isLarge?: boolean;
}

// File type validation
const validateFileType = (file: File, acceptFormats?: string[]): boolean => {
  if (!acceptFormats || acceptFormats.length === 0) return false;

  const fileName = file.name.toLowerCase();

  for (const format of acceptFormats) {
    if (format.endsWith('/*')) {
      // Check MIME type prefix (e.g., "video/*", "image/*", "text/*")
      const prefix = format.replace('/*', '');
      if (file.type.startsWith(prefix)) return true;
    } else if (format.startsWith('.')) {
      // Check file extension (e.g., ".txt", ".md")
      if (fileName.endsWith(format)) return true;
    } else if (file.type === format) {
      // Check exact MIME type
      return true;
    }
  }
  return false;
};

// 拖动排序的 MIME 类型
const CARD_DRAG_MIME = 'application/x-resource-card';

const ResourceSection: React.FC<ResourceSectionProps> = ({
  title,
  type,
  resources,
  acceptFormats,
  badge,
  badgeType = 'default',
  isText = false,
  isLarge = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const { selectedDraftId, addResource, addFrameAsResource, addTextResource, deleteResourcesByType, getResourcesByType } = useDraftStore();
  const { batchLink, getCustomOrder, setCustomOrder, swapOrder } = useSceneLinkStore();
  const { message } = App.useApp();

  const canDrop = !!acceptFormats && acceptFormats.length > 0;
  // 支持清除所有的资源类型
  const clearableTypes: ResourceType[] = ['scene_source', 'scene_new', 'scene_hd', 'lipsync'];
  const canClear = clearableTypes.includes(type) && resources.length > 0;
  // 只有 scene_new 才显示批量关联按钮
  const canBatchLink = type === 'scene_new';
  // 是否支持拖动排序
  const isSortable = SORTABLE_TYPES.includes(type as SortableType);

  // 初始化自定义排序（当资源列表变化时）
  useEffect(() => {
    if (!isSortable || resources.length === 0) return;

    const currentOrder = getCustomOrder(type as SortableType);
    const resourceIds = resources.map((r) => r.id);

    // 如果没有自定义排序或资源列表变化（有新增/删除），重新初始化
    if (!currentOrder || currentOrder.length !== resourceIds.length) {
      // 保留已有的顺序，添加新资源到末尾
      const newOrder = currentOrder
        ? [...currentOrder.filter((id) => resourceIds.includes(id)), ...resourceIds.filter((id) => !currentOrder.includes(id))]
        : resourceIds;
      setCustomOrder(type as SortableType, newOrder);
    }
  }, [isSortable, type, resources, getCustomOrder, setCustomOrder]);

  // 获取排序后的资源列表
  const sortedResources = useMemo(() => {
    if (!isSortable) return resources;

    const customOrder = getCustomOrder(type as SortableType);
    if (!customOrder) return resources;

    // 根据自定义排序重新排列资源
    const resourceMap = new Map(resources.map((r) => [r.id, r]));
    const sorted: Resource[] = [];
    for (const id of customOrder) {
      const resource = resourceMap.get(id);
      if (resource) {
        sorted.push(resource);
      }
    }
    // 添加不在排序中的资源（理论上不应该发生）
    for (const resource of resources) {
      if (!customOrder.includes(resource.id)) {
        sorted.push(resource);
      }
    }
    return sorted;
  }, [isSortable, type, resources, getCustomOrder]);

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      const result = await deleteResourcesByType(type);
      if (result.success > 0) {
        message.success(`已删除 ${result.success} 个${title}`);
      }
      if (result.failed > 0) {
        message.warning(`${result.failed} 个文件删除失败`);
      }
    } catch (error) {
      message.error('清除失败');
    } finally {
      setIsClearing(false);
    }
  };

  const handleBatchLink = () => {
    // 获取 scene_source 和 scene_new 资源列表
    const sceneSourceResources = getResourcesByType('scene_source');
    const sceneNewResources = getResourcesByType('scene_new');

    if (sceneSourceResources.length === 0 || sceneNewResources.length === 0) {
      message.warning('需要同时有分镜源视频和分镜新视频才能关联');
      return;
    }

    // 使用自定义排序（如果存在），否则使用默认排序
    const sourceOrder = getCustomOrder('scene_source');
    const newOrder = getCustomOrder('scene_new');

    // 按自定义排序获取 ID 列表
    const sortedSourceIds = sourceOrder
      ? sourceOrder.filter((id) => sceneSourceResources.some((r) => r.id === id))
      : sceneSourceResources.map((r) => r.id);
    const sortedNewIds = newOrder
      ? newOrder.filter((id) => sceneNewResources.some((r) => r.id === id))
      : sceneNewResources.map((r) => r.id);

    batchLink(sortedSourceIds, sortedNewIds);

    const linkedCount = Math.min(sortedSourceIds.length, sortedNewIds.length);
    message.success(`已关联 ${linkedCount} 对分镜视频`);
  };

  const handleAddPrompt = async () => {
    console.log('=== handleAddPrompt START ===');
    console.log('handleAddPrompt params:', { selectedDraftId, type, isText });
    if (!selectedDraftId) {
      console.error('handleAddPrompt: No selectedDraftId - aborting');
      message.error('请先选择一个草稿');
      return;
    }
    console.log('handleAddPrompt: Calling addTextResource...');
    try {
      const result = await addTextResource(selectedDraftId, type, '');
      console.log('handleAddPrompt result:', result);
      if (result) {
        message.success('已添加提示词');
        console.log('=== handleAddPrompt SUCCESS ===');
      } else {
        message.error('添加失败');
        console.error('=== handleAddPrompt FAILED (null result) ===');
      }
    } catch (error) {
      console.error('handleAddPrompt exception:', error);
      message.error('添加失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // 卡片拖动排序处理
  const handleCardDragStart = useCallback((e: React.DragEvent, resourceId: string) => {
    e.dataTransfer.setData(CARD_DRAG_MIME, JSON.stringify({ resourceId, type }));
    e.dataTransfer.effectAllowed = 'move';
  }, [type]);

  const handleCardDragOver = useCallback((e: React.DragEvent, resourceId: string) => {
    const data = e.dataTransfer.types.includes(CARD_DRAG_MIME);
    if (!data || !isSortable) return;

    e.preventDefault();
    e.stopPropagation();
    setDragOverCardId(resourceId);
  }, [isSortable]);

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCardId(null);
  }, []);

  const handleCardDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCardId(null);

    const dataStr = e.dataTransfer.getData(CARD_DRAG_MIME);
    if (!dataStr || !isSortable) return;

    try {
      const { resourceId: fromId, type: fromType } = JSON.parse(dataStr);
      // 只允许同类型之间排序
      if (fromType !== type || fromId === targetId) return;

      swapOrder(type as SortableType, fromId, targetId);
    } catch (error) {
      console.error('Failed to parse card drag data:', error);
    }
  }, [isSortable, type, swapOrder]);

  const handleCardDragEnd = useCallback(() => {
    setDragOverCardId(null);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有文件拖入时才高亮区域，卡片排序时不高亮
    if (canDrop && !e.dataTransfer.types.includes(CARD_DRAG_MIME)) {
      setIsDragOver(true);
    }
  }, [canDrop]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!canDrop || !selectedDraftId) return;

    // Check for frame data from video player
    const frameDataStr = e.dataTransfer.getData(FRAME_DATA_MIME);
    if (frameDataStr) {
      try {
        const frameData = JSON.parse(frameDataStr) as { imageData: string; fileName: string };
        const result = await addFrameAsResource(
          selectedDraftId,
          type,
          frameData.imageData,
          frameData.fileName
        );
        if (result) {
          message.success('已添加视频帧截图');
        } else {
          message.error('添加视频帧失败');
        }
      } catch (error) {
        console.error('Failed to add frame:', error);
        message.error('添加视频帧失败');
      }
      return;
    }

    // Handle regular file drops
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    let addedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      // Validate file type
      if (!validateFileType(file, acceptFormats)) {
        skippedCount++;
        continue;
      }

      // Get the file path - Electron provides this via the path property
      const filePath = (file as any).path;
      if (!filePath) {
        console.error('File path not available');
        skippedCount++;
        continue;
      }

      try {
        const result = await addResource(selectedDraftId, type, filePath);
        if (result) {
          addedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error('Failed to add resource:', error);
        skippedCount++;
      }
    }

    if (addedCount > 0) {
      message.success(`成功添加 ${addedCount} 个文件`);
    }
    if (skippedCount > 0) {
      message.warning(`${skippedCount} 个文件格式不支持或添加失败`);
    }
  }, [canDrop, selectedDraftId, type, acceptFormats, addResource, addFrameAsResource, message]);

  const contentClasses = [
    styles.content,
    isLarge ? styles.large : '',
    canDrop ? styles.droppable : '',
    isDragOver ? styles.dragOver : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.count}>{resources.length}</span>
        {isText && (
          <button className={styles.addButton} onClick={handleAddPrompt} title="添加提示词">
            <PlusOutlined />
          </button>
        )}
        {canBatchLink && (
          <Tooltip title="批量关联分镜源视频">
            <button className={`${styles.addButton} ${styles.linkButton}`} onClick={handleBatchLink}>
              <LinkOutlined />
            </button>
          </Tooltip>
        )}
        {canClear && (
          <Popconfirm
            title="确认清除"
            description={`确定要删除所有 ${resources.length} 个${title}吗？文件将被永久删除。`}
            onConfirm={handleClearAll}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: isClearing }}
          >
            <Tooltip title="清除所有">
              <button className={`${styles.addButton} ${styles.clearButton}`} disabled={isClearing}>
                <DeleteOutlined />
              </button>
            </Tooltip>
          </Popconfirm>
        )}
      </div>

      <div
        className={contentClasses}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {resources.length === 0 ? (
          <div className={styles.empty}>
            {canDrop ? (
              <div className={styles.dropHint}>
                <InboxOutlined className={styles.dropIcon} />
                <p className={styles.dropText}>
                  {isDragOver ? '松开以添加文件' : '拖拽文件到此处'}
                </p>
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`暂无${title}`}
              />
            )}
          </div>
        ) : (
          <div className={styles.grid}>
            {sortedResources.map((resource) =>
              isText ? (
                <PromptCard key={resource.id} resource={resource} />
              ) : (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  badge={badge}
                  badgeType={badgeType}
                  isLarge={isLarge}
                  draggable={isSortable}
                  isDragOver={dragOverCardId === resource.id}
                  onDragStart={(e) => handleCardDragStart(e, resource.id)}
                  onDragOver={(e) => handleCardDragOver(e, resource.id)}
                  onDragLeave={handleCardDragLeave}
                  onDrop={(e) => handleCardDrop(e, resource.id)}
                  onDragEnd={handleCardDragEnd}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResourceSection;
