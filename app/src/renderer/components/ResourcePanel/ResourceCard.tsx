import React, { useState, useRef, useEffect } from 'react';
import { PlayCircleOutlined, CheckCircleFilled, CloseOutlined } from '@ant-design/icons';
import { App } from 'antd';
import type { Resource } from '@shared/types';
import { isVideoMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { usePlaybackStore, CONTINUOUS_PLAY_TYPES } from '../../stores/playback';
import styles from './ResourceCard.module.css';

interface ResourceCardProps {
  resource: Resource;
  badge?: string;
  badgeType?: 'default' | 'success' | 'warning';
  isLarge?: boolean;
}

// Video thumbnail component that displays the first frame
const VideoThumbnail: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let isMounted = true;

    console.log('[VideoThumbnail] Starting to load video:', src);

    // Reset state
    setIsLoaded(false);
    setHasError(false);

    const handleLoadedMetadata = () => {
      if (!isMounted) return;
      console.log('[VideoThumbnail] loadedmetadata event, seeking to 0.1s');
      video.currentTime = 0.1;
    };

    const handleSeeked = () => {
      if (!isMounted) return;
      console.log('[VideoThumbnail] seeked event, video loaded successfully');
      setIsLoaded(true);
    };

    const handleError = () => {
      if (!isMounted) return;
      console.error('[VideoThumbnail] Failed to load video:', src, 'error:', video.error);
      setHasError(true);
    };

    // Register listeners BEFORE setting src
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    // Now set src and trigger load
    video.src = src;
    video.load();

    return () => {
      isMounted = false;
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
}) => {
  const { selectedResourceId, selectResource, deleteResource } = useDraftStore();
  const { setShouldAutoPlay } = usePlaybackStore();
  const { message } = App.useApp();
  const isSelected = selectedResourceId === resource.id;
  const isVideo = resource.mimeType.startsWith('video/');
  const isImage = resource.mimeType.startsWith('image/');

  // 检查是否支持点击播放
  const supportsContinuousPlay = isVideo && CONTINUOUS_PLAY_TYPES.includes(resource.type as typeof CONTINUOUS_PLAY_TYPES[number]);

  const handleClick = () => {
    // 如果是支持连续播放的视频类型，点击时触发自动播放
    if (supportsContinuousPlay) {
      setShouldAutoPlay(true);
    }
    selectResource(resource.id);
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
  // Add cache busting parameter using resource id and createdAt to force reload on content change
  const getLocalFileUrl = (filePath: string) => {
    // On Windows, paths start with drive letter like C:\
    // URL format should be: local-file:///C:/path/to/file
    const normalizedPath = filePath.replace(/\\/g, '/');
    // 使用资源 ID 和创建时间作为缓存破坏参数，确保文件更新后重新加载
    const cacheBuster = `${resource.id}_${new Date(resource.createdAt).getTime()}`;
    return `local-file:///${normalizedPath}?v=${cacheBuster}`;
  };

  const getThumbnail = () => {
    if (isImage) {
      return (
        <img
          src={getLocalFileUrl(resource.filePath)}
          alt={resource.fileName}
          className={styles.thumbnail}
        />
      );
    }

    // For video, show first frame as thumbnail
    if (isVideo) {
      return (
        <VideoThumbnail
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

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''} ${isLarge ? styles.large : ''}`}
      onClick={handleClick}
    >
      <div className={styles.thumbnailWrapper}>
        {getThumbnail()}

        <button className={styles.deleteButton} onClick={handleDelete}>
          <CloseOutlined />
        </button>

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
