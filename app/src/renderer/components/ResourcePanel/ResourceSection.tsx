import React, { useState, useCallback } from 'react';
import { Empty, App, Popconfirm, Tooltip } from 'antd';
import { InboxOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { Resource, ResourceType } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
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

  for (const format of acceptFormats) {
    if (format.endsWith('/*')) {
      // Check MIME type prefix (e.g., "video/*", "image/*")
      const prefix = format.replace('/*', '');
      if (file.type.startsWith(prefix)) return true;
    } else if (file.type === format) {
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
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const { selectedDraftId, addResource, addFrameAsResource, addTextResource, deleteResourcesByType } = useDraftStore();
  const { message } = App.useApp();

  const canDrop = !!acceptFormats && acceptFormats.length > 0;
  const canClear = type === 'scene_source' && resources.length > 0;

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

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (canDrop) {
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
            {resources.map((resource) =>
              isText ? (
                <PromptCard key={resource.id} resource={resource} />
              ) : (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  badge={badge}
                  badgeType={badgeType}
                  isLarge={isLarge}
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
