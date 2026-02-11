import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Empty, App, Popconfirm, Tooltip, Modal, Select } from 'antd';
import { InboxOutlined, PlusOutlined, DeleteOutlined, CloseOutlined, LinkOutlined, ThunderboltOutlined, MergeCellsOutlined, HolderOutlined } from '@ant-design/icons';
import type { Resource, SectionDescriptor, PromptTag } from '@shared/types';
import type { UpscaleDialogResult } from './UpscaleDialog';
import type { SynthesizeDialogResult } from './SynthesizeDialog';
import { getAcceptFormats, isTextSection, parseFolderName } from '@shared/section-utils';
import { useDraftStore } from '../../stores/draft';
import { useSectionsStore } from '../../stores/sections';
import { useSceneLinkStore } from '../../stores/sceneLink';

import ResourceCard from './ResourceCard';
import PromptCard from './PromptCard';
import UpscaleDialog from './UpscaleDialog';
import SynthesizeDialog from './SynthesizeDialog';
import GenerateImageDialog from '../PreviewPanel/GenerateImageDialog';
import styles from './ResourceSection.module.css';

// Custom MIME type for frame data transfer (must match VideoPlayer)
const FRAME_DATA_MIME = 'application/x-video-frame';

interface ResourceSectionProps {
  section: SectionDescriptor;
  resources: Resource[];
  allSections: SectionDescriptor[];
  cardScale?: number;
  badge?: string;
  badgeType?: 'default' | 'success' | 'warning';
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

// 文件扩展名到媒体类型的映射（用于 file.type 为空时的后备检查）
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  // Video
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.webm': 'video',
  // Image
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
  // Text
  '.txt': 'text',
  '.md': 'text',
};

// File type validation
const validateFileType = (file: File, acceptFormats?: string[]): boolean => {
  if (!acceptFormats || acceptFormats.length === 0) return false;

  const fileName = file.name.toLowerCase();
  const ext = fileName.substring(fileName.lastIndexOf('.'));

  for (const format of acceptFormats) {
    if (format.endsWith('/*')) {
      // Check MIME type prefix (e.g., "video/*", "image/*", "text/*")
      const prefix = format.replace('/*', '');

      // 首先检查 file.type
      if (file.type && file.type.startsWith(prefix)) return true;

      // 如果 file.type 为空，使用文件扩展名进行后备检查
      const mediaType = EXTENSION_MEDIA_TYPES[ext];
      if (mediaType && mediaType === prefix) return true;
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

// 检查两个 section 是否兼容（可以相互拖拽复制）
const areSectionsCompatible = (fromSectionId: string, toSectionId: string): boolean => {
  const fromDesc = parseFolderName(fromSectionId);
  const toDesc = parseFolderName(toSectionId);
  if (!fromDesc || !toDesc) return false;
  return fromDesc.mediaType === toDesc.mediaType;
};

const ResourceSection: React.FC<ResourceSectionProps> = ({
  section,
  resources,
  allSections,
  cardScale = 1,
  badge,
  badgeType = 'default',
  isLarge = false,
  isDragging = false,
  isDragOver = false,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDragLeave,
  onSectionDrop,
  onSectionDragEnd,
}) => {
  const sectionId = section.id;
  const title = `${section.order}. ${section.label}`;
  const isText = isTextSection(section.mediaType);
  const acceptFormats = getAcceptFormats(section.mediaType);
  const isVideo = section.mediaType === '视频';
  const isImage = section.mediaType === '图片';

  // 重命名状态
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [batchLinkDialogOpen, setBatchLinkDialogOpen] = useState(false);
  const [batchLinkTarget, setBatchLinkTarget] = useState<string | null>(null);
  const { selectedDraftId, addResource, addFrameAsResource, addTextResource, updateResource, deleteResourcesByType, getResourcesByType, loadResources, copyResource, reorderResource, clearLocalResourcesByType } = useDraftStore();
  const { batchLink } = useSceneLinkStore();
  const { renameSection, deleteSection } = useSectionsStore();
  const { message } = App.useApp();

  // 双击标题进入重命名
  const handleTitleDoubleClick = useCallback(() => {
    setRenameValue(title);
    setIsRenaming(true);
    // 等 DOM 更新后 focus
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [title]);

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === title) {
      setIsRenaming(false);
      return;
    }
    if (!selectedDraftId) return;

    const success = await renameSection(selectedDraftId, sectionId, trimmed);
    if (success) {
      // 重命名会改变 sectionId，需要重新加载资源
      await loadResources(selectedDraftId);
    } else {
      message.error('重命名失败');
    }
    setIsRenaming(false);
  }, [renameValue, title, selectedDraftId, sectionId, renameSection, loadResources, message]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameConfirm();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
    }
  }, [handleRenameConfirm]);

  // 删除整个 section
  const handleDeleteSection = useCallback(async () => {
    if (!selectedDraftId) return;
    const success = await deleteSection(selectedDraftId, sectionId);
    if (success) {
      await loadResources(selectedDraftId);
      message.success(`已删除「${title}」`);
    } else {
      message.error('删除失败');
    }
  }, [selectedDraftId, sectionId, title, deleteSection, loadResources, message]);

  const canDrop = acceptFormats.length > 0;
  // 所有 section 都可以清除
  const canClear = resources.length > 0;
  // 视频类型 section 可以批量关联、高清化、合成
  const canBatchLink = isVideo && resources.length > 0;
  const canUpscale = isVideo && resources.length > 0;
  const canSynthesize = isVideo && resources.length > 0;
  // 所有 section 都支持排序
  const isSortable = true;
  // 非文本类型支持拖拽复制
  const isDraggable = !isText;

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

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      const result = await deleteResourcesByType(sectionId);
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
    if (resources.length === 0) {
      message.warning('当前分组没有资源');
      return;
    }
    // 打开对话框让用户选择要关联的目标 section
    setBatchLinkTarget(null);
    setBatchLinkDialogOpen(true);
  };

  const handleBatchLinkConfirm = () => {
    if (!batchLinkTarget) {
      message.warning('请选择要关联的视频卡片栏');
      return;
    }

    const currentIds = resources.map((r) => r.id);
    const targetResources = getResourcesByType(batchLinkTarget);
    if (targetResources.length === 0) {
      message.warning('目标卡片栏没有资源');
      return;
    }

    const targetIds = targetResources.map((r) => r.id);

    // 规范化方向：小序号 section 为 source，大序号为 new
    const targetSection = allSections.find((s) => s.id === batchLinkTarget);
    if (section.order <= (targetSection?.order ?? 0)) {
      batchLink(currentIds, targetIds);
    } else {
      batchLink(targetIds, currentIds);
    }

    const count = Math.min(currentIds.length, targetIds.length);
    message.success(`已关联 ${count} 对资源`);
    setBatchLinkDialogOpen(false);
  };

  const handleUpscale = async (dialogResult: UpscaleDialogResult) => {
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
        config: dialogResult.config,
        targetSectionId: dialogResult.targetSectionId ?? undefined,
        newSectionLabel: dialogResult.newSectionLabel,
        clearTarget: dialogResult.clearTarget,
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

  const handleSynthesize = async (dialogResult: SynthesizeDialogResult) => {
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
        config: dialogResult.config,
        targetSectionId: dialogResult.targetSectionId ?? undefined,
        newSectionLabel: dialogResult.newSectionLabel,
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
    if (!selectedDraftId) {
      message.error('请先选择一个草稿');
      return;
    }
    try {
      // 读取剪贴板文本，自动填入新卡片
      let clipboardText = '';
      try {
        clipboardText = (await navigator.clipboard.readText()).trim();
      } catch {
        // 剪贴板无权限或无文本内容，忽略
      }

      // 解析第一行的 tag 指令，格式：#tag:image / #tag:text / #tag:video
      let parsedTag: PromptTag | '' = '';
      let content = clipboardText;
      if (clipboardText) {
        const firstLine = clipboardText.split('\n')[0].trim();
        const tagMatch = firstLine.match(/^#tag:(text|image|video)$/i);
        if (tagMatch) {
          parsedTag = tagMatch[1].toLowerCase() as PromptTag;
          content = clipboardText.substring(clipboardText.indexOf('\n') + 1).trim();
        }
      }

      const result = await addTextResource(selectedDraftId, sectionId, content);
      if (result) {
        // 如果解析到了 tag，立即更新资源的 tag（保存状态）
        if (parsedTag) {
          await updateResource(result.id, { content, encoding: 'utf-8', tag: parsedTag });
        }
        message.success(clipboardText ? '已添加提示词（已粘贴剪贴板内容）' : '已添加提示词');
      } else {
        message.error('添加失败');
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
    // 设置资源 ID 和 section ID，用于跨 Section 拖拽
    e.dataTransfer.setData('text/plain', resourceId);
    e.dataTransfer.setData('application/x-resource-type', sectionId);
  }, [isDraggable, sectionId]);

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

    setDragOverCardId(null);
    setDraggingCardId(null);

    // 检查是否是视频帧拖拽（从 VideoPlayer 拖拽截图）
    const frameDataStr = e.dataTransfer.getData(FRAME_DATA_MIME);
    if (frameDataStr && canDrop && selectedDraftId) {
      e.stopPropagation();
      try {
        const frameData = JSON.parse(frameDataStr) as { imageData: string; fileName: string };
        const result = await addFrameAsResource(selectedDraftId, sectionId, frameData.imageData, frameData.fileName);
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

    // 从 dataTransfer 读取数据（支持跨 section 拖拽）
    const fromId = e.dataTransfer.getData('text/plain') || draggingCardId;
    const fromSectionId = e.dataTransfer.getData('application/x-resource-type');

    // 不是资源拖拽也不是帧拖拽 → 不阻止冒泡，让外层 handleDrop 处理文件拖入
    if (!fromId || !isDraggable) return;

    e.stopPropagation();

    // 同区域拖拽 -> 调整顺序（通过重命名文件）
    if (fromSectionId === sectionId) {
      if (fromId === targetId) return; // 拖到自己身上，忽略
      if (isSortable) {
        await reorderResource(sectionId, fromId, targetId);
      }
      return;
    }

    // 跨区域拖拽 -> 复制
    // 验证类型兼容性
    if (fromSectionId && !areSectionsCompatible(fromSectionId, sectionId)) {
      const fromDesc = parseFolderName(fromSectionId);
      const toDesc = parseFolderName(sectionId);
      message.warning(`不能将${fromDesc?.mediaType || '未知'}复制到${toDesc?.mediaType || '未知'}区域`);
      return;
    }

    // 复制资源到目标 section
    const newResource = await copyResource(fromId, sectionId);
    if (newResource) {
      message.success('已复制');
    } else {
      message.error('复制失败');
    }
  }, [draggingCardId, isDraggable, copyResource, message, sectionId, isSortable, reorderResource, canDrop, selectedDraftId, addFrameAsResource]);

  const handleCardDragEnd = useCallback(() => {
    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);
  }, []);

  // 提示词卡片拖动排序处理
  const handlePromptDragStart = useCallback((e: React.DragEvent, resourceId: string) => {
    setDraggingCardId(resourceId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', resourceId);
    e.dataTransfer.setData('application/x-resource-type', sectionId);
  }, [sectionId]);

  const handlePromptDragOver = useCallback((e: React.DragEvent, resourceId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingCardId && resourceId === draggingCardId) return;
    setDragOverCardId(resourceId);
  }, [draggingCardId]);

  const handlePromptDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCardId(null);
  }, []);

  const handlePromptDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCardId(null);

    const fromId = draggingCardId;
    setDraggingCardId(null);

    if (!fromId || fromId === targetId) return;
    await reorderResource(sectionId, fromId, targetId);
  }, [draggingCardId, sectionId, reorderResource]);

  const handlePromptDragEnd = useCallback(() => {
    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);
  }, []);

  // 提示词末尾拖放区域
  const handlePromptEndZoneDragOver = useCallback((e: React.DragEvent) => {
    if (!draggingCardId) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverEndZone(true);
  }, [draggingCardId]);

  const handlePromptEndZoneDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const fromId = draggingCardId;
    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);

    if (!fromId) return;
    await reorderResource(sectionId, fromId, null);
  }, [draggingCardId, sectionId, reorderResource]);

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
    const fromSectionId = e.dataTransfer.getData('application/x-resource-type');

    setDragOverCardId(null);
    setDraggingCardId(null);
    setDragOverEndZone(false);

    if (!fromId || !isDraggable) return;

    // 同区域拖拽 -> 移动到末尾（toId 为 null）
    if (fromSectionId === sectionId) {
      if (isSortable) {
        await reorderResource(sectionId, fromId, null);
      }
      return;
    }

    // 跨区域拖拽 -> 复制
    if (fromSectionId && !areSectionsCompatible(fromSectionId, sectionId)) {
      const fromDesc = parseFolderName(fromSectionId);
      const toDesc = parseFolderName(sectionId);
      message.warning(`不能将${fromDesc?.mediaType || '未知'}复制到${toDesc?.mediaType || '未知'}区域`);
      return;
    }

    // 复制资源到目标 section
    const newResource = await copyResource(fromId, sectionId);
    if (newResource) {
      message.success('已复制');
    } else {
      message.error('复制失败');
    }
  }, [draggingCardId, isDraggable, copyResource, message, sectionId, isSortable, reorderResource]);

  // 处理拖拽到 grid 空白区域（最后一个卡片右边）
  const handleGridDragOver = useCallback((e: React.DragEvent) => {
    // 支持跨 section 拖拽
    const hasResourceType = e.dataTransfer.types.includes('application/x-resource-type');
    if (!hasResourceType || !isDraggable) return;
    e.preventDefault();
  }, [isDraggable]);

  const handleGridDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();

    // 检查是否是视频帧拖拽（从 VideoPlayer 拖拽截图）
    const frameDataStr = e.dataTransfer.getData(FRAME_DATA_MIME);
    if (frameDataStr && canDrop && selectedDraftId) {
      e.stopPropagation();
      try {
        const frameData = JSON.parse(frameDataStr) as { imageData: string; fileName: string };
        const result = await addFrameAsResource(selectedDraftId, sectionId, frameData.imageData, frameData.fileName);
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

    // 从 dataTransfer 读取数据（支持跨 section 拖拽）
    const fromId = e.dataTransfer.getData('text/plain') || draggingCardId;
    const fromSectionId = e.dataTransfer.getData('application/x-resource-type');

    // 不是资源拖拽也不是帧拖拽 → 不阻止冒泡，让外层 handleDrop 处理文件拖入
    if (!fromId || !isDraggable) return;

    e.stopPropagation();
    setDragOverCardId(null);
    setDraggingCardId(null);

    // 同区域拖拽 -> 移动到末尾（toId 为 null）
    if (fromSectionId === sectionId) {
      if (isSortable) {
        await reorderResource(sectionId, fromId, null);
      }
      return;
    }

    // 跨区域拖拽 -> 复制
    if (fromSectionId && !areSectionsCompatible(fromSectionId, sectionId)) {
      const fromDesc = parseFolderName(fromSectionId);
      const toDesc = parseFolderName(sectionId);
      message.warning(`不能将${fromDesc?.mediaType || '未知'}复制到${toDesc?.mediaType || '未知'}区域`);
      return;
    }

    // 复制资源到目标 section
    const newResource = await copyResource(fromId, sectionId);
    if (newResource) {
      message.success('已复制');
    } else {
      message.error('复制失败');
    }
  }, [draggingCardId, isDraggable, copyResource, message, sectionId, isSortable, reorderResource, canDrop, selectedDraftId, addFrameAsResource]);

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

    if (!selectedDraftId) return;

    // 首先检查是否是资源卡片拖拽（跨 section 复制）
    const fromId = e.dataTransfer.getData('text/plain');
    const fromSectionId = e.dataTransfer.getData('application/x-resource-type');
    if (fromId && fromSectionId && fromSectionId !== sectionId && isDraggable) {
      // 验证类型兼容性
      if (!areSectionsCompatible(fromSectionId, sectionId)) {
        const fromDesc = parseFolderName(fromSectionId);
        const toDesc = parseFolderName(sectionId);
        message.warning(`不能将${fromDesc?.mediaType || '未知'}复制到${toDesc?.mediaType || '未知'}区域`);
        return;
      }
      // 复制资源到目标 section
      const newResource = await copyResource(fromId, sectionId);
      if (newResource) {
        message.success('已复制');
      } else {
        message.error('复制失败');
      }
      return;
    }

    if (!canDrop) return;

    // Check for frame data from video player
    const frameDataStr = e.dataTransfer.getData(FRAME_DATA_MIME);
    if (frameDataStr) {
      try {
        const frameData = JSON.parse(frameDataStr) as { imageData: string; fileName: string };
        const result = await addFrameAsResource(
          selectedDraftId,
          sectionId,
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

    // Handle regular file drops（按文件名排序，确保序号与文件名顺序一致）
    const files = Array.from(e.dataTransfer.files)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    console.log('[ResourceSection] handleDrop: files count =', files.length, 'sectionId =', sectionId);
    if (files.length === 0) return;

    let addedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      console.log('[ResourceSection] Processing file:', file.name, 'type:', file.type, 'acceptFormats:', acceptFormats);

      // Validate file type
      if (!validateFileType(file, acceptFormats)) {
        console.warn('[ResourceSection] File type validation failed:', file.name, file.type);
        skippedCount++;
        continue;
      }

      // Get the file path - Electron provides this via the path property
      const filePath = (file as any).path;
      if (!filePath) {
        console.error('[ResourceSection] File path not available for:', file.name);
        skippedCount++;
        continue;
      }

      console.log('[ResourceSection] Adding resource:', { draftId: selectedDraftId, sectionId, filePath });
      try {
        const result = await addResource(selectedDraftId, sectionId, filePath);
        console.log('[ResourceSection] addResource result:', result);
        if (result) {
          addedCount++;
        } else {
          console.warn('[ResourceSection] addResource returned null');
          skippedCount++;
        }
      } catch (error) {
        console.error('[ResourceSection] Failed to add resource:', error);
        skippedCount++;
      }
    }

    if (addedCount > 0) {
      message.success(`成功添加 ${addedCount} 个文件`);
    }
    if (skippedCount > 0) {
      message.warning(`${skippedCount} 个文件格式不支持或添加失败`);
    }
  }, [canDrop, selectedDraftId, sectionId, acceptFormats, addResource, addFrameAsResource, message, isDraggable, copyResource]);

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
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className={styles.titleInput}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameConfirm}
            onKeyDown={handleRenameKeyDown}
          />
        ) : (
          <h3 className={styles.title} onDoubleClick={handleTitleDoubleClick}>{title}</h3>
        )}
        <span className={styles.count}>{resources.length}</span>
        {isText && (
          <Tooltip title="生成">
            <button className={`${styles.addButton} ${styles.upscaleButton}`} onClick={() => setGenerateDialogOpen(true)}>
              <ThunderboltOutlined />
            </button>
          </Tooltip>
        )}
        {isText && (
          <button className={`${styles.addButton} ${styles.upscaleButton}`} onClick={handleAddPrompt} title="添加提示词">
            <PlusOutlined />
          </button>
        )}
        {canBatchLink && (
          <Tooltip title="批量关联">
            <button className={`${styles.addButton} ${styles.linkButton}`} onClick={handleBatchLink}>
              <LinkOutlined />
            </button>
          </Tooltip>
        )}
        {canUpscale && (
          <Tooltip title="高清化所有视频">
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
          <Tooltip title="合成所有视频">
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
        <Popconfirm
          title="删除卡片栏"
          description={`确定要删除「${title}」卡片栏吗？${resources.length > 0 ? `其中的 ${resources.length} 个文件也将被永久删除。` : ''}`}
          onConfirm={handleDeleteSection}
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Tooltip title="删除卡片栏">
            <button className={`${styles.addButton} ${styles.deleteSectionButton}`}>
              <CloseOutlined />
            </button>
          </Tooltip>
        </Popconfirm>
      </div>

      <div
        className={contentClasses}
        style={{ '--card-scale': cardScale } as React.CSSProperties}
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
                <PromptCard
                  key={resource.id}
                  resource={resource}
                  cardScale={cardScale}
                  draggable={isSortable}
                  isDragOver={dragOverCardId === resource.id}
                  onDragStart={(e) => handlePromptDragStart(e, resource.id)}
                  onDragOver={(e) => handlePromptDragOver(e, resource.id)}
                  onDragLeave={handlePromptDragLeave}
                  onDrop={(e) => handlePromptDrop(e, resource.id)}
                  onDragEnd={handlePromptDragEnd}
                />
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
            {draggingCardId && isText && isSortable && (
              <div
                className={`${styles.dropEndZone} ${dragOverEndZone ? styles.dragOver : ''}`}
                onDragOver={handlePromptEndZoneDragOver}
                onDragLeave={handleEndZoneDragLeave}
                onDrop={handlePromptEndZoneDrop}
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
        sections={allSections}
        currentSectionId={sectionId}
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
        sections={allSections}
        currentSectionId={sectionId}
        isProcessing={isSynthesizing}
        progress={synthesizeProgress}
        onCancel={() => {
          if (!isSynthesizing) {
            setSynthesizeDialogOpen(false);
          }
        }}
        onOk={handleSynthesize}
      />

      {/* 批量关联对话框 */}
      <Modal
        title="批量关联"
        open={batchLinkDialogOpen}
        onCancel={() => setBatchLinkDialogOpen(false)}
        onOk={handleBatchLinkConfirm}
        okText="确认关联"
        cancelText="取消"
        okButtonProps={{ disabled: !batchLinkTarget }}
        width={400}
      >
        <div style={{ marginBottom: 12 }}>
          将「{title}」中的 {resources.length} 个资源按顺序与目标卡片栏的资源一一关联
        </div>
        <Select
          value={batchLinkTarget}
          onChange={setBatchLinkTarget}
          placeholder="选择目标视频卡片栏"
          style={{ width: '100%' }}
          options={allSections
            .filter((s) => s.mediaType === '视频' && s.id !== sectionId)
            .map((s) => ({
              label: `${s.order}. ${s.label}（${getResourcesByType(s.id).length} 个）`,
              value: s.id,
            }))}
        />
      </Modal>

      {/* 生成对话框（提示词栏直接打开） */}
      {isText && (
        <GenerateImageDialog
          visible={generateDialogOpen}
          sectionId={sectionId}
          onClose={() => setGenerateDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default ResourceSection;
