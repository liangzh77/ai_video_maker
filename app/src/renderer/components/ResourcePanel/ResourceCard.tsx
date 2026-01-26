import React from 'react';
import { PlayCircleOutlined, FileImageOutlined, CheckCircleFilled } from '@ant-design/icons';
import type { Resource } from '@shared/types';
import { isVideoMetadata, isImageMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './ResourceCard.module.css';

interface ResourceCardProps {
  resource: Resource;
  badge?: string;
  badgeType?: 'default' | 'success' | 'warning';
  isLarge?: boolean;
}

const ResourceCard: React.FC<ResourceCardProps> = ({
  resource,
  badge,
  badgeType = 'default',
  isLarge = false,
}) => {
  const { selectedResourceId, selectResource } = useDraftStore();
  const isSelected = selectedResourceId === resource.id;
  const isVideo = resource.mimeType.startsWith('video/');
  const isImage = resource.mimeType.startsWith('image/');

  const handleClick = () => {
    selectResource(resource.id);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getThumbnail = () => {
    if (isImage) {
      return (
        <img
          src={`local-file://${encodeURIComponent(resource.filePath)}`}
          alt={resource.fileName}
          className={styles.thumbnail}
        />
      );
    }

    // For video, show placeholder with play icon
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

      <div className={styles.info}>
        <div className={styles.name} title={resource.fileName}>
          {resource.fileName}
        </div>
        {isVideoMetadata(resource.metadata) && (
          <div className={styles.meta}>
            {resource.metadata.width}×{resource.metadata.height}
          </div>
        )}
        {isImageMetadata(resource.metadata) && (
          <div className={styles.meta}>
            {resource.metadata.width}×{resource.metadata.height}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResourceCard;
