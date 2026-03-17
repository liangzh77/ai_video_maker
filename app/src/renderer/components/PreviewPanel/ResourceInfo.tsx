import React, { useState, useEffect } from 'react';
import { Button, Tooltip, Popconfirm, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { Resource, ResourceMetadataFile } from '@shared/types';
import { isVideoMetadata, isImageMetadata, isAudioMetadata } from '@shared/types';
import { parseFolderName } from '@shared/section-utils';
import { useDraftStore } from '../../stores/draft';
import styles from './ResourceInfo.module.css';

interface ResourceInfoProps {
  resource: Resource;
}

const GenerationTypeLabel: Record<string, string> = {
  image: '图片生成',
  text: '文本生成',
  video: '视频生成',
};

const ResourceInfo: React.FC<ResourceInfoProps> = ({ resource }) => {
  const { deleteResource, selectResource } = useDraftStore();

  // 加载生成信息
  const [generationMeta, setGenerationMeta] = useState<ResourceMetadataFile['generation'] | null>(null);
  useEffect(() => {
    setGenerationMeta(null);
    if (!resource.hasGenerationMeta) return;
    window.api.resource.loadMetadata({
      draftId: resource.draftId,
      resourceId: resource.id,
    }).then((result) => {
      if (result.success && result.data?.generation) {
        setGenerationMeta(result.data.generation);
      }
    }).catch(() => {});
  }, [resource.id, resource.draftId, resource.hasGenerationMeta]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, '0')}`;
  };

  const getResourceTypeLabel = (type: string): string => {
    const desc = parseFolderName(type);
    return desc?.label || type;
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
  const isAudio = isAudioMetadata(resource.metadata);

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
            <div className={styles.item}>
              <span className={styles.label}>总帧数</span>
              <span className={styles.value}>{Math.round(resource.metadata.duration * resource.metadata.fps)}</span>
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

        {isAudio && (
          <>
            <div className={styles.item}>
              <span className={styles.label}>时长</span>
              <span className={styles.value}>{formatDuration(resource.metadata.duration)}</span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>采样率</span>
              <span className={styles.value}>{resource.metadata.sampleRate} Hz</span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>比特率</span>
              <span className={styles.value}>{resource.metadata.bitrate} kbps</span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>声道</span>
              <span className={styles.value}>{resource.metadata.channels}</span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>编码</span>
              <span className={styles.value}>{resource.metadata.codec}</span>
            </div>
          </>
        )}

        <div className={styles.item}>
          <span className={styles.label}>文件大小</span>
          <span className={styles.value}>{formatFileSize(resource.fileSize)}</span>
        </div>
      </div>

      {generationMeta && (
        <div className={styles.generation}>
          <h4 className={styles.title}>生成信息</h4>
          <div className={styles.grid}>
            <div className={styles.item}>
              <span className={styles.label}>生成类型</span>
              <span className={styles.value}>{GenerationTypeLabel[generationMeta.type] || generationMeta.type}</span>
            </div>
            <div className={styles.item}>
              <span className={styles.label}>生成时间</span>
              <span className={styles.value}>{new Date(generationMeta.generatedAt).toLocaleString()}</span>
            </div>
            {generationMeta.type === 'video' && generationMeta.params && (
              generationMeta.params.method === 'runninghub' ? (
                <>
                  <div className={styles.item}>
                    <span className={styles.label}>生成方式</span>
                    <span className={styles.value}>RunningHub</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>宽</span>
                    <span className={styles.value}>{generationMeta.params.rhWidth}</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>高</span>
                    <span className={styles.value}>{generationMeta.params.rhHeight}</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>帧率</span>
                    <span className={styles.value}>{generationMeta.params.rhFps}</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>帧数</span>
                    <span className={styles.value}>{generationMeta.params.rhRunningFrames}</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>跳帧</span>
                    <span className={styles.value}>{generationMeta.params.rhSkipFrames}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.item}>
                    <span className={styles.label}>生成方式</span>
                    <span className={styles.value}>即梦</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>时长</span>
                    <span className={styles.value}>{generationMeta.params.duration}s</span>
                  </div>
                  <div className={styles.item}>
                    <span className={styles.label}>比例</span>
                    <span className={styles.value}>{generationMeta.params.ratio}</span>
                  </div>
                </>
              )
            )}
          </div>
          <div className={styles.promptBlock}>
            <span className={styles.label}>提示词</span>
            <p className={styles.promptText}>{generationMeta.prompt}</p>
          </div>
        </div>
      )}

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
