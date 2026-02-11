import React from 'react';
import { App } from 'antd';
import { CloseOutlined, ThunderboltOutlined, CopyOutlined } from '@ant-design/icons';
import type { Resource, PromptTag } from '@shared/types';
import { isTextMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './PromptCard.module.css';

const TAG_CONFIG: Record<PromptTag, { label: string; className: string }> = {
  text: { label: '文本', className: styles.tagText },
  image: { label: '图片', className: styles.tagImage },
  video: { label: '视频', className: styles.tagVideo },
};

interface PromptCardProps {
  resource: Resource;
  cardScale?: number;
  draggable?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

const PromptCard: React.FC<PromptCardProps> = ({
  resource,
  cardScale = 1,
  draggable = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) => {
  const { selectedResourceId, selectResource, deleteResource, setPendingGenerate } = useDraftStore();
  const { message } = App.useApp();
  const isSelected = selectedResourceId === resource.id;

  const metadata = isTextMetadata(resource.metadata) ? resource.metadata : null;
  const content = metadata?.content ?? '';
  const tag = metadata?.tag;

  const handleClick = () => {
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

  const handleGenerate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!content || content.trim().length === 0) {
      message.warning('请先输入提示词内容');
      return;
    }
    selectResource(resource.id);
    setPendingGenerate(resource.id);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = tag ? `#tag:${tag}\n${content}` : content;
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制');
    } catch {
      message.error('复制失败');
    }
  };

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''} ${isDragOver ? styles.dragOver : ''} ${draggable ? styles.draggable : ''}`}
      onClick={handleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <button className={styles.deleteButton} onClick={handleDelete} title="删除">
        <CloseOutlined />
      </button>

      {tag && (
        <span className={`${styles.tag} ${TAG_CONFIG[tag].className}`}>
          {TAG_CONFIG[tag].label}
        </span>
      )}

      <div className={styles.content}>
        {content || <span className={styles.empty}>暂无内容</span>}
      </div>

      {cardScale >= 0.55 && (
        <button className={styles.generateButton} onClick={handleGenerate} title="生成">
          <ThunderboltOutlined />
          <span>生成</span>
        </button>
      )}

      {cardScale >= 0.55 && (
        <button className={styles.copyButton} onClick={handleCopy} title="复制">
          <CopyOutlined />
        </button>
      )}
    </div>
  );
};

export default PromptCard;
