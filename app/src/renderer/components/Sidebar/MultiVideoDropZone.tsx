import React, { useState, useCallback } from 'react';
import { Tooltip, App } from 'antd';
import { PlayCircleOutlined, CloseOutlined, DeleteOutlined, VideoCameraOutlined } from '@ant-design/icons';
import type { Resource, VideoMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { useDraftStore } from '../../stores/draft';
import MultiVideoPlayerDialog from './MultiVideoPlayerDialog';
import styles from './MultiVideoDropZone.module.css';

// 最多支持4个视频
const MAX_VIDEOS = 4;

const MultiVideoDropZone: React.FC = () => {
  const { message } = App.useApp();
  const { getResourceById } = useDraftStore();
  const [videos, setVideos] = useState<Resource[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 判断是否是竖屏视频（宽高比 < 1）
  const isPortrait = useCallback((video: Resource): boolean => {
    const meta = video.metadata as VideoMetadata;
    if (meta.width && meta.height) {
      return meta.height > meta.width;
    }
    return false;
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

    // 只接受视频类型
    const desc = parseFolderName(resourceType);
    if (!desc || desc.mediaType !== '视频') {
      message.warning('只能添加视频');
      return;
    }

    // 检查是否已添加
    if (videos.some(v => v.id === resourceId)) {
      message.info('该视频已添加');
      return;
    }

    // 检查数量限制
    if (videos.length >= MAX_VIDEOS) {
      message.warning(`最多只能添加 ${MAX_VIDEOS} 个视频`);
      return;
    }

    // 获取资源详情
    const resource = getResourceById(resourceId);
    if (resource) {
      setVideos(prev => [...prev, resource]);
    }
  }, [videos, getResourceById, message]);

  const handleRemoveVideo = useCallback((resourceId: string) => {
    setVideos(prev => prev.filter(v => v.id !== resourceId));
  }, []);

  const handleClearAll = useCallback(() => {
    setVideos([]);
  }, []);

  const handlePlay = useCallback(() => {
    if (videos.length < 2) {
      message.info('至少需要2个视频才能播放');
      return;
    }
    setDialogOpen(true);
  }, [videos, message]);

  // 获取视频缩略图 URL
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

  const canPlay = videos.length >= 2;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>
          <VideoCameraOutlined className={styles.titleIcon} />
          多视频播放
        </span>
        <span className={styles.count}>{videos.length}/{MAX_VIDEOS}</span>
        {videos.length > 0 && (
          <Tooltip title="清空所有">
            <button className={styles.clearButton} onClick={handleClearAll}>
              <DeleteOutlined />
            </button>
          </Tooltip>
        )}
      </div>

      <div
        className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''} ${videos.length === 0 ? styles.empty : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {videos.length === 0 ? (
          <div className={styles.placeholder}>
            <VideoCameraOutlined className={styles.placeholderIcon} />
            <span>拖入视频</span>
          </div>
        ) : (
          <div className={styles.videoGrid}>
            {videos.map((video) => {
              const meta = video.metadata as VideoMetadata;
              return (
                <div key={video.id} className={styles.videoItem}>
                  <video
                    src={getLocalFileUrl(video.filePath, video.fileSize)}
                    className={styles.videoThumbnail}
                    muted
                  />
                  <span className={styles.videoDuration}>
                    {formatDuration(meta.duration || 0)}
                  </span>
                  <button
                    className={styles.removeButton}
                    onClick={() => handleRemoveVideo(video.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canPlay && (
        <button className={styles.playButton} onClick={handlePlay}>
          <PlayCircleOutlined />
          <span>播放 {videos.length} 个视频</span>
        </button>
      )}

      <MultiVideoPlayerDialog
        visible={dialogOpen}
        videos={videos}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
};

export default MultiVideoDropZone;
