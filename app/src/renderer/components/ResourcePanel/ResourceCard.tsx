import React, { useState, useEffect } from 'react';
import { PlayCircleOutlined, CheckCircleFilled, CloseOutlined, LinkOutlined, VideoCameraOutlined, LoadingOutlined } from '@ant-design/icons';
import { App } from 'antd';
import type { Resource, OperationResult } from '@shared/types';
import { isVideoMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { useDraftStore } from '../../stores/draft';
import { usePlaybackStore, isContinuousPlayType } from '../../stores/playback';
import { useSceneLinkStore } from '../../stores/sceneLink';
import { useFullscreenPreviewStore } from '../../stores/fullscreenPreview';
import styles from './ResourceCard.module.css';

// 缩略图缓存（resourceId -> thumbnailPath）
const thumbnailCache = new Map<string, string>();
// 正在请求中的缩略图（防止重复请求）
const pendingRequests = new Map<string, Promise<string | null>>();

/**
 * 清除指定前缀的缩略图缓存
 * 用于重排序后刷新缓存
 * @param prefix 资源 ID 前缀，如 '分镜源视频/'
 */
export function clearThumbnailCache(prefix?: string): void {
  if (!prefix) {
    thumbnailCache.clear();
    pendingRequests.clear();
    return;
  }

  // 清除匹配前缀的缓存
  for (const key of thumbnailCache.keys()) {
    if (key.startsWith(prefix)) {
      thumbnailCache.delete(key);
    }
  }
  for (const key of pendingRequests.keys()) {
    if (key.startsWith(prefix)) {
      pendingRequests.delete(key);
    }
  }
}

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

// 缓存的缩略图组件 - 使用后端生成的缩略图
interface CachedThumbnailProps {
  resource: Resource;
  isVideo: boolean;
}

const CachedThumbnail: React.FC<CachedThumbnailProps> = ({ resource, isVideo }) => {
  // 缓存 key 包含 fileSize，确保同 ID 不同文件不会命中旧缓存
  const cacheKey = `${resource.id}_${resource.fileSize}`;
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(() => {
    // 检查内存缓存
    return thumbnailCache.get(cacheKey) || null;
  });
  const [isLoading, setIsLoading] = useState(!thumbnailPath);
  const [hasError, setHasError] = useState(false);

  // 获取缩略图
  useEffect(() => {
    // 如果已经有缓存的缩略图，不需要请求
    if (thumbnailPath) {
      return;
    }

    let isMounted = true;

    const fetchThumbnail = async () => {
      // 检查是否已有正在进行的请求
      const existingRequest = pendingRequests.get(cacheKey);
      if (existingRequest) {
        const path = await existingRequest;
        if (isMounted && path) {
          setThumbnailPath(path);
          setIsLoading(false);
        }
        return;
      }

      // 创建新请求
      const requestPromise = (async () => {
        try {
          const result: OperationResult<string> = await window.api.resource.getThumbnail({
            draftId: resource.draftId,
            resourceId: resource.id,
          });

          if (result.success && result.data) {
            thumbnailCache.set(cacheKey, result.data);
            return result.data;
          }
          return null;
        } catch (err) {
          console.error('[CachedThumbnail] Failed to get thumbnail:', resource.id, err);
          return null;
        } finally {
          pendingRequests.delete(cacheKey);
        }
      })();

      pendingRequests.set(cacheKey, requestPromise);

      const path = await requestPromise;
      if (isMounted) {
        if (path) {
          setThumbnailPath(path);
        } else {
          setHasError(true);
        }
        setIsLoading(false);
      }
    };

    fetchThumbnail();

    return () => {
      isMounted = false;
    };
  }, [resource.id, resource.draftId, thumbnailPath]);

  // 构建缩略图 URL
  const getThumbnailUrl = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    // 使用资源文件大小作为缓存破坏参数
    return `local-file:///${normalizedPath}?v=${resource.fileSize}`;
  };

  if (isLoading) {
    return (
      <div className={styles.videoPlaceholder}>
        <LoadingOutlined className={styles.playIcon} />
      </div>
    );
  }

  if (hasError || !thumbnailPath) {
    return (
      <div className={styles.videoPlaceholder}>
        {isVideo ? <PlayCircleOutlined className={styles.playIcon} /> : null}
      </div>
    );
  }

  return (
    <img
      src={getThumbnailUrl(thumbnailPath)}
      alt={resource.fileName}
      className={styles.thumbnail}
      draggable={false}
      onError={() => setHasError(true)}
    />
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

  // 检查是否支持点击播放（所有视频类型 section 都支持）
  const supportsContinuousPlay = isVideo && isContinuousPlayType(resource.type);

  // 检查是否是当前选中资源的关联资源
  const selectedResource = getSelectedResource();
  const isLinked = (() => {
    if (!selectedResource || isSelected) return false;
    // 双向查找：检查当前资源是否与选中资源关联
    const linkedId = getLinkedId(resource.id);
    return linkedId === selectedResource.id;
  })();

  // 检查是否可以显示关联按钮（当选中的是不同视频 section 的资源时）
  const canShowLinkButton = (() => {
    if (!selectedResource || isSelected) return false;
    // 不同 section 的视频资源之间可以关联
    if (resource.type === selectedResource.type) return false; // 同一 section
    const myDesc = parseFolderName(resource.type);
    const selectedDesc = parseFolderName(selectedResource.type);
    if (!myDesc || !selectedDesc) return false;
    return myDesc.mediaType === '视频' && selectedDesc.mediaType === '视频';
  })();

  const handleLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedResource) return;
    // 设置关联（选中资源为 source，点击的资源为 target）
    setLink(selectedResource.id, resource.id);
    message.success('已关联');
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

  const getThumbnail = () => {
    // 对于图片和视频，使用缓存的缩略图
    if (isImage || isVideo) {
      return (
        <CachedThumbnail
          key={`${resource.id}_${resource.fileSize}`}
          resource={resource}
          isVideo={isVideo}
        />
      );
    }

    // Fallback placeholder for other types
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

        {isVideo && (
          <span className={styles.videoIndicator}>
            <VideoCameraOutlined />
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
