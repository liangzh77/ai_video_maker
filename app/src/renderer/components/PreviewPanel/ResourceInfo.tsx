import React from 'react';
import { Button, Tooltip, Popconfirm, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { Resource } from '@shared/types';
import { isVideoMetadata, isImageMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './ResourceInfo.module.css';

interface ResourceInfoProps {
  resource: Resource;
}

const ResourceInfo: React.FC<ResourceInfoProps> = ({ resource }) => {
  const { deleteResource, selectResource } = useDraftStore();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getResourceTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      source_video: '源视频',
      source_character: '源角色图片',
      prompt: '提示词',
      new_character: '新角色图片',
      scene_source: '分镜源视频',
      scene_new: '分镜新视频',
      scene_hd: '高清分镜新视频',
      lipsync: '对口型新视频',
      synthesized: '合成新视频',
    };
    return labels[type] || type;
  };

  const handleDelete = async () => {
    const success = await deleteResource(resource.id);
    if (success) {
      selectResource(null);
      message.success('资源已删除');
    } else {
      message.error('删除失败');
    }
  };

  const isVideo = isVideoMetadata(resource.metadata);
  const isImage = isImageMetadata(resource.metadata);

  return (
    <div className={styles.info}>
      <div className={styles.header}>
        <h4 className={styles.title}>资源信息</h4>
      </div>

      <div className={styles.grid}>
        <div className={styles.item}>
          <span className={styles.label}>文件名</span>
          <span className={styles.value} title={resource.fileName}>
            {resource.fileName}
          </span>
        </div>

        <div className={styles.item}>
          <span className={styles.label}>类型</span>
          <span className={styles.value}>{getResourceTypeLabel(resource.type)}</span>
        </div>

        {isVideo && (
          <>
            <div className={styles.item}>
              <span className={styles.label}>时长</span>
              <span className={styles.value}>{formatDuration(resource.metadata.duration)}</span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>分辨率</span>
              <span className={styles.value}>
                {resource.metadata.width}×{resource.metadata.height}
              </span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>帧率</span>
              <span className={styles.value}>{resource.metadata.fps} fps</span>
            </div>
          </>
        )}

        {isImage && (
          <div className={styles.item}>
            <span className={styles.label}>尺寸</span>
            <span className={styles.value}>
              {resource.metadata.width}×{resource.metadata.height}
            </span>
          </div>
        )}

        <div className={styles.item}>
          <span className={styles.label}>文件大小</span>
          <span className={styles.value}>{formatFileSize(resource.fileSize)}</span>
        </div>
      </div>

      <div className={styles.actions}>
        <Popconfirm
          title="删除资源"
          description="确定要删除这个资源吗？"
          onConfirm={handleDelete}
          okText="删除"
          cancelText="取消"
          okType="danger"
        >
          <Tooltip title="删除资源">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Tooltip>
        </Popconfirm>
      </div>
    </div>
  );
};

export default ResourceInfo;
