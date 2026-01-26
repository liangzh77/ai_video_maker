import React, { useState, useCallback } from 'react';
import { Empty, App } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { Resource, ResourceType } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import ResourceCard from './ResourceCard';
import PromptCard from './PromptCard';
import styles from './ResourceSection.module.css';

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
  const { selectedDraftId, addResource } = useDraftStore();
  const { message } = App.useApp();

  const canDrop = !!acceptFormats && acceptFormats.length > 0;

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
  }, [canDrop, selectedDraftId, type, acceptFormats, addResource]);

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
