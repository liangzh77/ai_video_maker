import React, { useState, useRef, useEffect } from 'react';
import { PlayCircleOutlined, CheckCircleFilled, CloseOutlined, LinkOutlined } from '@ant-design/icons';
import { App } from 'antd';
import type { Resource } from '@shared/types';
import { isVideoMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { usePlaybackStore, CONTINUOUS_PLAY_TYPES } from '../../stores/playback';
import { useSceneLinkStore } from '../../stores/sceneLink';
import { useFullscreenPreviewStore } from '../../stores/fullscreenPreview';
import styles from './ResourceCard.module.css';

interface ResourceCardProps {
  resource: Resource;
  badge?: string;
  badgeType?: 'default' | 'success' | 'warning';
  isLarge?: boolean;
  // 拖动排序相关 props
  draggable?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

// Video thumbnail component that displays the first frame
const VideoThumbnail: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const retryDelayMs = 500;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let isMounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const loadVideo = () => {
      if (!isMounted) return;

      // Reset state
      setIsLoaded(false);
      setHasError(false);

      // Clear and reload
      video.pause();
      video.removeAttribute('src');
      video.src = src;
      video.load();
    };

    const handleLoadedMetadata = () => {
      if (!isMounted) return;
      video.currentTime = 0.1;
    };

    const handleSeeked = () => {
      if (!isMounted) return;
      retryCountRef.current = 0; // Reset retry count on success
      setIsLoaded(true);
    };

    const handleError = () => {
      if (!isMounted) return;
      console.error('[VideoThumbnail] Failed to load video:', src, 'retry:', retryCountRef.current);

      // Retry loading if we haven't exceeded max retries
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        retryTimeout = setTimeout(() => {
          if (isMounted) {
            loadVideo();
          }
        }, retryDelayMs * retryCountRef.current);
      } else {
        setHasError(true);
      }
    };

    // Register listeners BEFORE setting src
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    // Reset retry count for new src
    retryCountRef.current = 0;

    // Initial load with a small delay to ensure file is ready
    retryTimeout = setTimeout(loadVideo, 100);

    return () => {
      isMounted = false;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
      // Release file reference to prevent file locking
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  return (
    <>
      {/* Always render video element, hide with CSS when not loaded */}
      <video
        ref={videoRef}
        className={styles.thumbnail}
        preload="auto"
        muted
        playsInline
        crossOrigin="anonymous"
        draggable={false}
        style={{
          opacity: isLoaded && !hasError ? 1 : 0,
          position: isLoaded && !hasError ? 'relative' : 'absolute',
        }}
      />
      {(!isLoaded || hasError) && (
        <div className={styles.videoPlaceholder} style={{ position: 'absolute', inset: 0 }}>
          <PlayCircleOutlined className={styles.playIcon} />
        </div>
      )}
    </>
  );
};

const ResourceCard: React.FC<ResourceCardProps> = ({
  resource,
  badge,
  badgeType = 'default',
  isLarge = false,
  draggable = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) => {
  const { selectedResourceId, selectResource, deleteResource, getSelectedResource } = useDraftStore();
  const { isPlaying, setShouldAutoPlay, startPlaying } = usePlaybackStore();
  const { getLinkedId, setLink } = useSceneLinkStore();
  const { openFullscreen } = useFullscreenPreviewStore();
  const { message } = App.useApp();
  const isSelected = selectedResourceId === resource.id;
  const isVideo = resource.mimeType.startsWith('video/');
  const isImage = resource.mimeType.startsWith('image/');

  // 检查是否支持点击播放
  const supportsContinuousPlay = isVideo && CONTINUOUS_PLAY_TYPES.includes(resource.type as typeof CONTINUOUS_PLAY_TYPES[number]);

  // 检查是否是当前选中资源的关联资源
  const selectedResource = getSelectedResource();
  const isLinked = (() => {
    if (!selectedResource || isSelected) return false;

    // 只有 scene_source 和 scene_new 之间才有关联
    if (resource.type === 'scene_source' && selectedResource.type === 'scene_new') {
      const linkedSourceId = getLinkedId(selectedResource.id, 'scene_new');
      return linkedSourceId === resource.id;
    }
    if (resource.type === 'scene_new' && selectedResource.type === 'scene_source') {
      const linkedNewId = getLinkedId(selectedResource.id, 'scene_source');
      return linkedNewId === resource.id;
    }
    return false;
  })();

  // 检查是否可以显示关联按钮（当选中的是另一类型的资源时）
  const canShowLinkButton = (() => {
    if (!selectedResource || isSelected) return false;

    // 当选中 scene_source 时，scene_new 区域的卡片显示关联按钮
    if (selectedResource.type === 'scene_source' && resource.type === 'scene_new') {
      return true;
    }
    // 当选中 scene_new 时，scene_source 区域的卡片显示关联按钮
    if (selectedResource.type === 'scene_new' && resource.type === 'scene_source') {
      return true;
    }
    return false;
  })();

  const handleLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedResource) return;

    // 根据当前资源类型设置关联
    if (resource.type === 'scene_source' && selectedResource.type === 'scene_new') {
      setLink(resource.id, selectedResource.id);
      message.success('已关联');
    } else if (resource.type === 'scene_new' && selectedResource.type === 'scene_source') {
      setLink(selectedResource.id, resource.id);
      message.success('已关联');
    }
  };

  const handleClick = () => {
    // 如果是支持连续播放的视频类型，且当前正在播放，点击时触发自动播放
    if (supportsContinuousPlay && isPlaying) {
      setShouldAutoPlay(true);
    }
    selectResource(resource.id);
  };

  // 双击处理 - 使用全局 store 打开全屏预览
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isImage) {
      openFullscreen(resource.id, 'image', resource.type);
    } else if (isVideo) {
      // 通知其他播放器暂停
      startPlaying('fullscreen');
      openFullscreen(resource.id, 'video', resource.type);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await deleteResource(resource.id);
    if (success) {
      message.success('已删除');
    } else {
      message.error('删除失败');
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Build local file URL - need triple slash for Windows paths
  // Add cache busting parameter using fileSize to force reload on content change
  const getLocalFileUrl = (filePath: string) => {
    // On Windows, paths start with drive letter like C:\
    // URL format should be: local-file:///C:/path/to/file
    const normalizedPath = filePath.replace(/\\/g, '/');
    // 使用资源文件大小作为缓存破坏参数，确保文件更新后重新加载（如 resplit 后）
    return `local-file:///${normalizedPath}?v=${resource.fileSize}`;
  };

  const getThumbnail = () => {
    if (isImage) {
      return (
        <img
          src={getLocalFileUrl(resource.filePath)}
          alt={resource.fileName}
          className={styles.thumbnail}
          draggable={false}
        />
      );
    }

    // For video, show first frame as thumbnail
    if (isVideo) {
      // 使用 fileSize 和 duration 作为 key，确保视频更新后重新加载缩略图
      const videoDuration = isVideoMetadata(resource.metadata) ? resource.metadata.duration : 0;
      return (
        <VideoThumbnail
          key={`${resource.id}_${resource.fileSize}_${videoDuration}`}
          src={getLocalFileUrl(resource.filePath)}
          alt={resource.fileName}
        />
      );
    }

    // Fallback placeholder
    return (
      <div className={styles.videoPlaceholder}>
        <PlayCircleOutlined className={styles.playIcon} />
      </div>
    );
  };

  const cardClassName = [
    styles.card,
    isSelected ? styles.selected : '',
    isLinked ? styles.linked : '',
    isLarge ? styles.large : '',
    isDragOver ? styles.dragOver : '',
    draggable ? styles.draggable : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClassName}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title="双击放大查看"
    >
      <div className={styles.thumbnailWrapper}>
        {getThumbnail()}

        <button className={styles.deleteButton} onClick={handleDelete}>
          <CloseOutlined />
        </button>

        {canShowLinkButton && (
          <button className={styles.linkButton} onClick={handleLinkClick} title="关联到选中的视频">
            <LinkOutlined />
          </button>
        )}

        {badge && (
          <span className={`${styles.badge} ${styles[badgeType]}`}>
            {badgeType === 'success' && <CheckCircleFilled />}
            {badge}
          </span>
        )}

        {isVideo && isVideoMetadata(resource.metadata) && (
          <span className={styles.duration}>
            {formatDuration(resource.metadata.duration)}
          </span>
        )}
      </div>
    </div>
  );
};

export default ResourceCard;
