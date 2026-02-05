import React, { useState, useCallback, useEffect } from 'react';
import { Empty, App, Popconfirm, Tooltip } from 'antd';
import { InboxOutlined, PlusOutlined, DeleteOutlined, LinkOutlined, ThunderboltOutlined, MergeCellsOutlined, HolderOutlined } from '@ant-design/icons';
import type { Resource, ResourceType, UpscaleConfig, SynthesizeConfig } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useSceneLinkStore } from '../../stores/sceneLink';

// 支持拖动排序的资源类型（通过重命名文件实现）
const SORTABLE_TYPES: ResourceType[] = ['scene_source', 'scene_new', 'scene_hd', 'lipsync', 'source_character', 'new_character', 'prompt'];

// 支持拖拽复制的资源类型（所有非文本类型）
const DRAGGABLE_TYPES: ResourceType[] = ['source_video', 'source_character', 'new_character', 'scene_source', 'scene_new', 'scene_hd', 'lipsync', 'synthesized'];

// 按媒体类型分组的资源类型（用于跨类型拖拽兼容性检查）
const VIDEO_TYPES: ResourceType[] = ['source_video', 'scene_source', 'scene_new', 'scene_hd', 'lipsync', 'synthesized'];
const IMAGE_TYPES: ResourceType[] = ['source_character', 'new_character'];

// 获取资源类型的媒体类型
const getMediaType = (resourceType: ResourceType): 'video' | 'image' | 'text' => {
  if (VIDEO_TYPES.includes(resourceType)) return 'video';
  if (IMAGE_TYPES.includes(resourceType)) return 'image';
  return 'text';
};

// 检查两个资源类型是否兼容（可以相互拖拽复制）
const areTypesCompatible = (fromType: ResourceType, toType: ResourceType): boolean => {
  return getMediaType(fromType) === getMediaType(toType);
};
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
  const { selectedDraftId, addResource, addFrameAsResource, addTextResource, deleteResourcesByType, getResourcesByType, loadResources, copyResource, reorderResource, clearLocalResourcesByType } = useDraftStore();
  const { batchLink } = useSceneLinkStore();
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
  const isSortable = SORTABLE_TYPES.includes(type);
  // 是否支持拖拽复制（所有非文本类型都支持）
  const isDraggable = DRAGGABLE_TYPES.includes(type);

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

  // 资源列表已经按文件名排序（由 getResourcesByType 实现）
  // 直接使用 resources 即可

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
    // 获取 scene_source 和 scene_new 资源列表（已按文件名排序）
    const sceneSourceResources = getResourcesByType('scene_source');
    const sceneNewResources = getResourcesByType('scene_new');

    if (sceneSourceResources.length === 0 || sceneNewResources.length === 0) {
      message.warning('需要同时有分镜源视频和分镜新视频才能关联');
      return;
    }

    // 资源已按文件名排序，直接使用
    const sortedSourceIds = sceneSourceResources.map((r) => r.id);
    const sortedNewIds = sceneNewResources.map((r) => r.id);

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
      // 获取排序后的资源 ID 列表（resources 已按文件名排序）
      const videoIds = resources.map((r) => r.id);

      const result = await window.api.task.upscaleVideo({
        draftId: selectedDraftId,
        sourceVideoIds: videoIds,
        config,
      });

      if (result.success && result.data) {
        // 保存任务 ID 用于监听进度
        setUpscaleTaskId(result.data.id);

        // 立即从前端状态中移除 scene_hd 资源
        // 因为后端会在任务开始时删除这些资源，这样可以避免在任务完成后出现重复卡片
        clearLocalResourcesByType('scene_hd');
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
      // 获取排序后的资源 ID 列表（resources 已按文件名排序）
      const videoIds = resources.map((r) => r.id);

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

  // 卡片拖动处理 - 支持拖拽复制
  const handleCardDragStart = useCallback((e: React.DragEvent, resourceId: string) => {
    if (!isDraggable) return;
    setDraggingCardId(resourceId);
    e.dataTransfer.effectAllowed = 'copy';
    // 设置资源 ID 和类型，用于跨 Section 拖拽
    e.dataTransfer.setData('text/plain', resourceId);
    e.dataTransfer.setData('application/x-resource-type', type);
  }, [isDraggable, type]);

  const handleCardDragOver = useCallback((e: React.DragEvent, resourceId: string) => {
    // 必须调用 preventDefault 才能使元素成为有效的 drop 目标
    e.preventDefault();
    e.stopPropagation();

    // 检查是否有资源类型数据（支持跨 section 拖拽）
    const fromType = e.dataTransfer.types.includes('application/x-resource-type');
    if (!fromType || !isDraggable) return;

    // 本地拖拽时不高亮自己
    if (draggingCardId && resourceId === draggingCardId) return;

    setDragOverCardId(resourceId);
  }, [draggingCardId, isDraggable]);

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCardId(null);
  }, []);

  const handleCardDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 从 dataTransfer 读取数据（支持跨 section 拖拽）
    const fromId = e.dataTransfer.getData('text/plain') || draggingCardId;
    const fromType = e.dataTransfer.getData('application/x-resource-type') as ResourceType;

    setDragOverCardId(null);
    setDraggingCardId(null);

    if (!fromId || !isDraggable) return;

    // 同区域拖拽 -> 调整顺序（通过重命名文件）
    if (fromType === type) {
      if (fromId === targetId) return; // 拖到自己身上，忽略
      if (isSortable) {
        await reorderResource(type, fromId, targetId);
      }
      return;
    }

    // 跨区域拖拽 -> 复制
    // 验证类型兼容性
    if (fromType && !areTypesCompatible(fromType, type)) {
      message.warning(`不能将${getMediaType(fromType) === 'video' ? '视频' : '图片'}复制到${getMediaType(type) === 'video' ? '视频' : '图片'}区域`);
      return;
    }

    // 复制资源到目标类型
    const newResource = await copyResource(fromId, type);
    if (newResource) {
      message.success('已复制');
    } else {
      message.error('复制失败');
    }
  }, [draggingCardId, isDraggable, copyResource, message, type, isSortable, reorderResource]);

  const handleCardDragEnd = useCallback(() => {
    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);
  }, []);

  // 处理拖拽到末尾占位区域
  const handleEndZoneDragOver = useCallback((e: React.DragEvent) => {
    // 支持跨 section 拖拽
    const hasResourceType = e.dataTransfer.types.includes('application/x-resource-type');
    if (!hasResourceType || !isDraggable) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverEndZone(true);
  }, [isDraggable]);

  const handleEndZoneDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverEndZone(false);
  }, []);

  const handleEndZoneDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 从 dataTransfer 读取数据（支持跨 section 拖拽）
    const fromId = e.dataTransfer.getData('text/plain') || draggingCardId;
    const fromType = e.dataTransfer.getData('application/x-resource-type') as ResourceType;

    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);

    if (!fromId || !isDraggable) return;

    // 同区域拖拽 -> 移动到末尾（toId 为 null）
    if (fromType === type) {
      if (isSortable) {
        await reorderResource(type, fromId, null);
      }
      return;
    }

    // 跨区域拖拽 -> 复制
    // 验证类型兼容性
    if (fromType && !areTypesCompatible(fromType, type)) {
      message.warning(`不能将${getMediaType(fromType) === 'video' ? '视频' : '图片'}复制到${getMediaType(type) === 'video' ? '视频' : '图片'}区域`);
      return;
    }

    // 复制资源到目标类型
    const newResource = await copyResource(fromId, type);
    if (newResource) {
      message.success('已复制');
    } else {
      message.error('复制失败');
    }
  }, [draggingCardId, isDraggable, copyResource, message, type, isSortable, reorderResource]);

  // 处理拖拽到 grid 空白区域（最后一个卡片右边）
  const handleGridDragOver = useCallback((e: React.DragEvent) => {
    // 支持跨 section 拖拽
    const hasResourceType = e.dataTransfer.types.includes('application/x-resource-type');
    if (!hasResourceType || !isDraggable) return;
    e.preventDefault();
  }, [isDraggable]);

  const handleGridDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 从 dataTransfer 读取数据（支持跨 section 拖拽）
    const fromId = e.dataTransfer.getData('text/plain') || draggingCardId;
    const fromType = e.dataTransfer.getData('application/x-resource-type') as ResourceType;

    // 如果没有资源 ID 或不支持拖拽，则返回
    if (!fromId || !isDraggable) return;

    setDragOverCardId(null);
    setDraggingCardId(null);

    // 同区域拖拽 -> 移动到末尾（toId 为 null）
    if (fromType === type) {
      if (isSortable) {
        await reorderResource(type, fromId, null);
      }
      return;
    }

    // 跨区域拖拽 -> 复制
    // 验证类型兼容性
    if (fromType && !areTypesCompatible(fromType, type)) {
      message.warning(`不能将${getMediaType(fromType) === 'video' ? '视频' : '图片'}复制到${getMediaType(type) === 'video' ? '视频' : '图片'}区域`);
      return;
    }

    // 复制资源到目标类型
    const newResource = await copyResource(fromId, type);
    if (newResource) {
      message.success('已复制');
    } else {
      message.error('复制失败');
    }
  }, [draggingCardId, isDraggable, copyResource, message, type, isSortable, reorderResource]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有文件拖入时才高亮区域，资源卡片拖拽时不高亮
    const isResourceDrag = e.dataTransfer.types.includes('application/x-resource-type') || draggingCardId;
    if (canDrop && !isResourceDrag) {
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
            {resources.map((resource) =>
              isText ? (
                <PromptCard key={resource.id} resource={resource} />
              ) : (
                <ResourceCard
                  key={`${resource.id}_${resource.fileSize}_${(resource.metadata as any)?.duration ?? ''}`}
                  resource={resource}
                  badge={badge}
                  badgeType={badgeType}
                  isLarge={isLarge}
                  draggable={isDraggable}
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
            {draggingCardId && isDraggable && (
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
