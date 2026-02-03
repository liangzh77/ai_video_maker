import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Empty, App, Popconfirm, Tooltip } from 'antd';
import { InboxOutlined, PlusOutlined, DeleteOutlined, LinkOutlined, ThunderboltOutlined, MergeCellsOutlined, HolderOutlined } from '@ant-design/icons';
import type { Resource, ResourceType, UpscaleConfig, SynthesizeConfig } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useSceneLinkStore, SORTABLE_TYPES, type SortableType } from '../../stores/sceneLink';
import ResourceCard from './ResourceCard';
import PromptCard from './PromptCard';
import UpscaleDialog from './UpscaleDialog';
import SynthesizeDialog from './SynthesizeDialog';
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
  // Section 拖拽排序相关
  isDragging?: boolean;
  isDragOver?: boolean;
  onSectionDragStart?: (e: React.DragEvent) => void;
  onSectionDragOver?: (e: React.DragEvent) => void;
  onSectionDragLeave?: (e: React.DragEvent) => void;
  onSectionDrop?: (e: React.DragEvent) => void;
  onSectionDragEnd?: () => void;
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

const ResourceSection: React.FC<ResourceSectionProps> = ({
  title,
  type,
  resources,
  acceptFormats,
  badge,
  badgeType = 'default',
  isText = false,
  isLarge = false,
  isDragging = false,
  isDragOver = false,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDragLeave,
  onSectionDrop,
  onSectionDragEnd,
}) => {
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragOverEndZone, setDragOverEndZone] = useState(false);
  const [upscaleDialogOpen, setUpscaleDialogOpen] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleProgress, setUpscaleProgress] = useState(0);
  const [upscaleTaskId, setUpscaleTaskId] = useState<string | null>(null);
  const [synthesizeDialogOpen, setSynthesizeDialogOpen] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesizeProgress, setSynthesizeProgress] = useState(0);
  const [synthesizeTaskId, setSynthesizeTaskId] = useState<string | null>(null);
  const { selectedDraftId, addResource, addFrameAsResource, addTextResource, deleteResourcesByType, getResourcesByType, loadResources } = useDraftStore();
  const { batchLink, getCustomOrder, setCustomOrder, moveOrder, moveToEnd, customOrder } = useSceneLinkStore();
  const { message } = App.useApp();

  const canDrop = !!acceptFormats && acceptFormats.length > 0;
  // 支持清除所有的资源类型
  const clearableTypes: ResourceType[] = ['scene_source', 'scene_new', 'scene_hd', 'lipsync'];
  const canClear = clearableTypes.includes(type) && resources.length > 0;
  // 只有 scene_new 才显示批量关联按钮
  const canBatchLink = type === 'scene_new';
  // 只有 scene_new 才显示高清化按钮
  const canUpscale = type === 'scene_new' && resources.length > 0;
  // 只有 lipsync 才显示合成按钮
  const canSynthesize = type === 'lipsync' && resources.length > 0;
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

  // 监听任务进度和完成事件
  useEffect(() => {
    if (!upscaleTaskId) return;

    const handleProgress = (_event: any, data: { taskId: string; progress: number; status: string }) => {
      if (data.taskId === upscaleTaskId) {
        setUpscaleProgress(data.progress);

        // 如果任务失败
        if (data.status === 'failed') {
          setIsUpscaling(false);
          setUpscaleTaskId(null);
          setUpscaleDialogOpen(false);
          message.error('高清化任务失败');
        }
      }
    };

    const handleCompleted = (_event: any, data: { taskId: string; outputResourceIds: string[] }) => {
      if (data.taskId === upscaleTaskId) {
        setUpscaleProgress(100);
        setIsUpscaling(false);
        setUpscaleTaskId(null);
        setUpscaleDialogOpen(false);
        message.success(`高清化完成，生成了 ${data.outputResourceIds.length} 个视频`);

        // 刷新资源列表
        if (selectedDraftId) {
          loadResources(selectedDraftId);
        }
      }
    };

    const unsubProgress = window.api.on('task:progress', handleProgress);
    const unsubCompleted = window.api.on('task:completed', handleCompleted);

    return () => {
      unsubProgress();
      unsubCompleted();
    };
  }, [upscaleTaskId, selectedDraftId, loadResources, message]);

  // 监听合成任务进度和完成事件
  useEffect(() => {
    if (!synthesizeTaskId) return;

    const handleProgress = (_event: any, data: { taskId: string; progress: number; status: string; error?: string }) => {
      if (data.taskId === synthesizeTaskId) {
        setSynthesizeProgress(data.progress);

        // 如果任务失败
        if (data.status === 'failed') {
          setIsSynthesizing(false);
          setSynthesizeTaskId(null);
          setSynthesizeDialogOpen(false);
          message.error(`合成任务失败: ${data.error || '未知错误'}`);
          console.error('[Synthesize] Task failed:', data.error);
        }
      }
    };

    const handleCompleted = (_event: any, data: { taskId: string; outputResourceIds: string[] }) => {
      if (data.taskId === synthesizeTaskId) {
        setSynthesizeProgress(100);
        setIsSynthesizing(false);
        setSynthesizeTaskId(null);
        setSynthesizeDialogOpen(false);
        message.success('视频合成完成');

        // 刷新资源列表
        if (selectedDraftId) {
          loadResources(selectedDraftId);
        }
      }
    };

    const unsubProgress = window.api.on('task:progress', handleProgress);
    const unsubCompleted = window.api.on('task:completed', handleCompleted);

    return () => {
      unsubProgress();
      unsubCompleted();
    };
  }, [synthesizeTaskId, selectedDraftId, loadResources, message]);

  // 获取排序后的资源列表
  // 注意：依赖 customOrder 状态而不只是 getCustomOrder 函数，确保状态变化时重新计算
  const sortedResources = useMemo(() => {
    if (!isSortable) return resources;

    const order = customOrder.get(type as SortableType);
    if (!order) return resources;

    // 根据自定义排序重新排列资源
    const resourceMap = new Map(resources.map((r) => [r.id, r]));
    const sorted: Resource[] = [];
    for (const id of order) {
      const resource = resourceMap.get(id);
      if (resource) {
        sorted.push(resource);
      }
    }
    // 添加不在排序中的资源（理论上不应该发生）
    for (const resource of resources) {
      if (!order.includes(resource.id)) {
        sorted.push(resource);
      }
    }
    return sorted;
  }, [isSortable, type, resources, customOrder]);

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

  const handleUpscale = async (config: UpscaleConfig) => {
    if (!selectedDraftId || resources.length === 0) return;

    // 开始处理，保持对话框打开显示进度
    setIsUpscaling(true);
    setUpscaleProgress(0);

    try {
      // 获取排序后的资源 ID 列表
      const videoIds = sortedResources.map((r) => r.id);

      const result = await window.api.task.upscaleVideo({
        draftId: selectedDraftId,
        sourceVideoIds: videoIds,
        config,
      });

      if (result.success && result.data) {
        // 保存任务 ID 用于监听进度
        setUpscaleTaskId(result.data.id);
      } else {
        message.error(result.error || '启动高清化任务失败');
        setIsUpscaling(false);
        setUpscaleDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to start upscale task:', error);
      message.error('启动高清化任务失败');
      setIsUpscaling(false);
      setUpscaleDialogOpen(false);
    }
  };

  const handleSynthesize = async (config: SynthesizeConfig) => {
    if (!selectedDraftId || resources.length === 0) return;

    // 开始处理，保持对话框打开显示进度
    setIsSynthesizing(true);
    setSynthesizeProgress(0);

    try {
      // 获取排序后的资源 ID 列表
      const videoIds = sortedResources.map((r) => r.id);

      const result = await window.api.task.synthesizeVideo({
        draftId: selectedDraftId,
        videoResourceIds: videoIds,
        config,
      });

      if (result.success && result.data) {
        // 保存任务 ID 用于监听进度
        setSynthesizeTaskId(result.data.id);
      } else {
        message.error(result.error || '启动合成任务失败');
        setIsSynthesizing(false);
        setSynthesizeDialogOpen(false);
      }
    } catch (error) {
      console.error('Failed to start synthesize task:', error);
      message.error('启动合成任务失败');
      setIsSynthesizing(false);
      setSynthesizeDialogOpen(false);
    }
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

  // 卡片拖动排序处理 - 使用组件状态而不是 dataTransfer MIME 类型
  const handleCardDragStart = useCallback((e: React.DragEvent, resourceId: string) => {
    if (!isSortable) return;
    setDraggingCardId(resourceId);
    e.dataTransfer.effectAllowed = 'move';
    // 设置一个简单的文本数据，某些浏览器需要这个才能正常工作
    e.dataTransfer.setData('text/plain', resourceId);
  }, [isSortable]);

  const handleCardDragOver = useCallback((e: React.DragEvent, resourceId: string) => {
    // 必须调用 preventDefault 才能使元素成为有效的 drop 目标
    e.preventDefault();
    e.stopPropagation();

    // 只有在拖动卡片时才显示高亮
    if (!draggingCardId || !isSortable) return;
    if (resourceId !== draggingCardId) {
      setDragOverCardId(resourceId);
    }
  }, [draggingCardId, isSortable]);

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCardId(null);
  }, []);

  const handleCardDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const fromId = draggingCardId;
    setDragOverCardId(null);
    setDraggingCardId(null);

    if (!fromId || !isSortable || fromId === targetId) return;

    // 确保 customOrder 已初始化（防止 moveOrder 因为 customOrder 不存在而失败）
    const currentOrder = getCustomOrder(type as SortableType);
    if (!currentOrder) {
      // 初始化排序并执行移动
      const resourceIds = resources.map((r) => r.id);
      const fromIndex = resourceIds.indexOf(fromId);
      const toIndex = resourceIds.indexOf(targetId);
      if (fromIndex !== -1 && toIndex !== -1) {
        // 移动到目标位置前面：先移除，再插入
        const newOrder = [...resourceIds];
        newOrder.splice(fromIndex, 1);
        const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
        newOrder.splice(insertIndex, 0, fromId);
        setCustomOrder(type as SortableType, newOrder);
      }
      return;
    }

    moveOrder(type as SortableType, fromId, targetId);
  }, [draggingCardId, isSortable, type, moveOrder, getCustomOrder, setCustomOrder, resources]);

  const handleCardDragEnd = useCallback(() => {
    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);
  }, []);

  // 处理拖拽到末尾占位区域
  const handleEndZoneDragOver = useCallback((e: React.DragEvent) => {
    if (!draggingCardId || !isSortable) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverEndZone(true);
  }, [draggingCardId, isSortable]);

  const handleEndZoneDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverEndZone(false);
  }, []);

  const handleEndZoneDrop = useCallback((e: React.DragEvent) => {
    if (!draggingCardId || !isSortable) return;

    e.preventDefault();
    e.stopPropagation();

    const fromId = draggingCardId;
    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);

    // 确保 customOrder 已初始化
    const currentOrder = getCustomOrder(type as SortableType);
    if (!currentOrder) {
      const resourceIds = resources.map((r) => r.id);
      const fromIndex = resourceIds.indexOf(fromId);
      if (fromIndex !== -1 && fromIndex !== resourceIds.length - 1) {
        const newOrder = [...resourceIds];
        newOrder.splice(fromIndex, 1);
        newOrder.push(fromId);
        setCustomOrder(type as SortableType, newOrder);
      }
      return;
    }

    moveToEnd(type as SortableType, fromId);
  }, [draggingCardId, isSortable, type, moveToEnd, getCustomOrder, setCustomOrder, resources]);

  // 处理拖拽到 grid 空白区域（最后一个卡片右边）
  const handleGridDragOver = useCallback((e: React.DragEvent) => {
    // 只有在拖动卡片时才允许 drop
    if (!draggingCardId || !isSortable) return;
    e.preventDefault();
  }, [draggingCardId, isSortable]);

  const handleGridDrop = useCallback((e: React.DragEvent) => {
    // 只处理卡片拖拽（不是文件拖入）
    if (!draggingCardId || !isSortable) return;

    e.preventDefault();
    e.stopPropagation();

    const fromId = draggingCardId;
    setDragOverCardId(null);
    setDraggingCardId(null);

    // 确保 customOrder 已初始化
    const currentOrder = getCustomOrder(type as SortableType);
    if (!currentOrder) {
      // 初始化排序并移动到末尾
      const resourceIds = resources.map((r) => r.id);
      const fromIndex = resourceIds.indexOf(fromId);
      if (fromIndex !== -1 && fromIndex !== resourceIds.length - 1) {
        const newOrder = [...resourceIds];
        newOrder.splice(fromIndex, 1);
        newOrder.push(fromId);
        setCustomOrder(type as SortableType, newOrder);
      }
      return;
    }

    moveToEnd(type as SortableType, fromId);
  }, [draggingCardId, isSortable, type, moveToEnd, getCustomOrder, setCustomOrder, resources]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有文件拖入时才高亮区域，卡片排序时不高亮
    if (canDrop && !draggingCardId) {
      setIsFileDragOver(true);
    }
  }, [canDrop, draggingCardId]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFileDragOver(false);

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
    isFileDragOver ? styles.dragOver : '',
  ].filter(Boolean).join(' ');

  // Section 容器的样式类
  const sectionClasses = [
    styles.section,
    isDragging ? styles.sectionDragging : '',
    isDragOver ? styles.sectionDragOver : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={sectionClasses}
      onDragOver={onSectionDragOver}
      onDragLeave={onSectionDragLeave}
      onDrop={onSectionDrop}
    >
      <div className={styles.header}>
        {/* 拖拽把手 */}
        <div
          className={styles.dragHandle}
          draggable
          onDragStart={onSectionDragStart}
          onDragEnd={onSectionDragEnd}
        >
          <HolderOutlined />
        </div>
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
        {canUpscale && (
          <Tooltip title="高清化所有分镜新视频">
            <button
              className={`${styles.addButton} ${styles.upscaleButton}`}
              onClick={() => setUpscaleDialogOpen(true)}
              disabled={isUpscaling}
            >
              <ThunderboltOutlined />
            </button>
          </Tooltip>
        )}
        {canSynthesize && (
          <Tooltip title="合成所有对口型视频">
            <button
              className={`${styles.addButton} ${styles.synthesizeButton}`}
              onClick={() => setSynthesizeDialogOpen(true)}
              disabled={isSynthesizing}
            >
              <MergeCellsOutlined />
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
                  {isFileDragOver ? '松开以添加文件' : '拖拽文件到此处'}
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
          <div
            className={styles.grid}
            onDragOver={handleGridDragOver}
            onDrop={handleGridDrop}
          >
            {sortedResources.map((resource) =>
              isText ? (
                <PromptCard key={resource.id} resource={resource} />
              ) : (
                <ResourceCard
                  key={`${resource.id}_${resource.fileSize}_${(resource.metadata as any)?.duration ?? ''}`}
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
            {/* 拖拽时显示末尾拖放区域 */}
            {draggingCardId && isSortable && (
              <div
                className={`${styles.dropEndZone} ${dragOverEndZone ? styles.dragOver : ''}`}
                onDragOver={handleEndZoneDragOver}
                onDragLeave={handleEndZoneDragLeave}
                onDrop={handleEndZoneDrop}
              >
                末尾
              </div>
            )}
          </div>
        )}
      </div>

      {/* 高清化设置对话框 */}
      <UpscaleDialog
        open={upscaleDialogOpen}
        videoCount={resources.length}
        isProcessing={isUpscaling}
        progress={upscaleProgress}
        onCancel={() => {
          if (!isUpscaling) {
            setUpscaleDialogOpen(false);
          }
        }}
        onOk={handleUpscale}
      />

      {/* 合成设置对话框 */}
      <SynthesizeDialog
        open={synthesizeDialogOpen}
        videoCount={resources.length}
        isProcessing={isSynthesizing}
        progress={synthesizeProgress}
        onCancel={() => {
          if (!isSynthesizing) {
            setSynthesizeDialogOpen(false);
          }
        }}
        onOk={handleSynthesize}
      />
    </div>
  );
};

export default ResourceSection;
