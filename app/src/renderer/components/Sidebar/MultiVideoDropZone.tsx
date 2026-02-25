import React, { useState, useCallback, useMemo } from 'react';
import { Tooltip, App } from 'antd';
import { PlayCircleOutlined, CloseOutlined, DeleteOutlined, FileTextOutlined, SwapOutlined, AudioOutlined } from '@ant-design/icons';
import type { Resource, VideoMetadata, AudioMetadata, TextMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { useDraftStore } from '../../stores/draft';
import MultiVideoPlayerDialog from './MultiVideoPlayerDialog';
import CompareTranscriptDialog from './CompareTranscriptDialog';
import styles from './MultiVideoDropZone.module.css';

// 最多支持4个资源
const MAX_RESOURCES = 4;

// 允许的媒体类型
const ALLOWED_MEDIA_TYPES = new Set(['视频', '声音', '提示词']);

const MultiVideoDropZone: React.FC = () => {
  const { message } = App.useApp();
  const { getResourceById } = useDraftStore();
  const [resources, setResources] = useState<Resource[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);

  // 获取资源的媒体类型
  const getMediaType = useCallback((resource: Resource): string => {
    const desc = parseFolderName(resource.type);
    return desc?.mediaType || '';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有资源拖拽时才响应
    if (e.dataTransfer.types.includes('application/x-resource-type')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // 从 dataTransfer 读取资源 ID 和类型
    const resourceId = e.dataTransfer.getData('text/plain');
    const resourceType = e.dataTransfer.getData('application/x-resource-type');

    if (!resourceId) return;

    // 检查媒体类型
    const desc = parseFolderName(resourceType);
    if (!desc || !ALLOWED_MEDIA_TYPES.has(desc.mediaType)) {
      message.warning('只能添加视频、音频或提示词');
      return;
    }

    // 检查是否已添加
    if (resources.some(r => r.id === resourceId)) {
      message.info('该资源已添加');
      return;
    }

    // 检查数量限制
    if (resources.length >= MAX_RESOURCES) {
      message.warning(`最多只能添加 ${MAX_RESOURCES} 个资源`);
      return;
    }

    // 获取资源详情
    const resource = getResourceById(resourceId);
    if (resource) {
      setResources(prev => [...prev, resource]);
    }
  }, [resources, getResourceById, message]);

  const handleRemoveResource = useCallback((resourceId: string) => {
    setResources(prev => prev.filter(r => r.id !== resourceId));
  }, []);

  const handleClearAll = useCallback(() => {
    setResources([]);
  }, []);

  // 筛选出视频资源
  const videoResources = useMemo(() => {
    return resources.filter(r => getMediaType(r) === '视频');
  }, [resources, getMediaType]);

  const allAreVideos = videoResources.length === resources.length && resources.length > 0;
  const canPlay = allAreVideos && resources.length >= 2;
  const canCompare = resources.length === 2;

  const handlePlay = useCallback(() => {
    if (!canPlay) return;
    setDialogOpen(true);
  }, [canPlay]);

  // 获取本地文件 URL
  const getLocalFileUrl = (filePath: string, fileSize?: number) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const cacheKey = fileSize ? `?v=${fileSize}` : '';
    return `local-file:///${normalizedPath}${cacheKey}`;
  };

  // 格式化时长
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 渲染单个资源项
  const renderResourceItem = (resource: Resource) => {
    const mediaType = getMediaType(resource);

    if (mediaType === '视频') {
      const meta = resource.metadata as VideoMetadata;
      return (
        <div key={resource.id} className={styles.resourceItem}>
          <video
            src={getLocalFileUrl(resource.filePath, resource.fileSize)}
            className={styles.videoThumbnail}
            muted
          />
          <span className={styles.badge}>
            {formatDuration(meta.duration || 0)}
          </span>
          <button
            className={styles.removeButton}
            onClick={() => handleRemoveResource(resource.id)}
          >
            <CloseOutlined />
          </button>
        </div>
      );
    }

    if (mediaType === '声音') {
      const meta = resource.metadata as AudioMetadata;
      return (
        <div key={resource.id} className={`${styles.resourceItem} ${styles.audioItem}`}>
          <AudioOutlined className={styles.resourceIcon} />
          <span className={styles.resourceName}>{resource.fileName}</span>
          <span className={styles.badge}>
            {formatDuration(meta.duration || 0)}
          </span>
          <button
            className={styles.removeButton}
            onClick={() => handleRemoveResource(resource.id)}
          >
            <CloseOutlined />
          </button>
        </div>
      );
    }

    if (mediaType === '提示词') {
      const meta = resource.metadata as TextMetadata;
      const preview = meta.content?.slice(0, 30) || resource.fileName;
      return (
        <div key={resource.id} className={`${styles.resourceItem} ${styles.textItem}`}>
          <FileTextOutlined className={styles.resourceIcon} />
          <span className={styles.resourceName} title={meta.content}>
            {preview}{meta.content && meta.content.length > 30 ? '...' : ''}
          </span>
          <button
            className={styles.removeButton}
            onClick={() => handleRemoveResource(resource.id)}
          >
            <CloseOutlined />
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          <SwapOutlined className={styles.titleIcon} />
          多资源比对
        </span>
        <span className={styles.count}>{resources.length}/{MAX_RESOURCES}</span>
        {resources.length > 0 && (
          <Tooltip title="清空所有">
            <button className={styles.clearButton} onClick={handleClearAll}>
              <DeleteOutlined />
            </button>
          </Tooltip>
        )}
      </div>

      <div
        className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''} ${resources.length === 0 ? styles.empty : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {resources.length === 0 ? (
          <div className={styles.placeholder}>
            <SwapOutlined className={styles.placeholderIcon} />
            <span>拖入资源</span>
          </div>
        ) : (
          <div className={styles.resourceGrid}>
            {resources.map(renderResourceItem)}
          </div>
        )}
      </div>

      {(canPlay || canCompare) && (
        <div className={styles.buttonGroup}>
          {canPlay && (
            <button className={styles.playButton} onClick={handlePlay}>
              <PlayCircleOutlined />
              <span>播放</span>
            </button>
          )}
          {canCompare && (
            <button className={styles.compareButton} onClick={() => setCompareDialogOpen(true)}>
              <FileTextOutlined />
              <span>对比文案</span>
            </button>
          )}
        </div>
      )}

      <MultiVideoPlayerDialog
        visible={dialogOpen}
        videos={videoResources}
        onClose={() => setDialogOpen(false)}
      />

      <CompareTranscriptDialog
        visible={compareDialogOpen}
        resources={resources}
        onClose={() => setCompareDialogOpen(false)}
      />
    </div>
  );
};

export default MultiVideoDropZone;
