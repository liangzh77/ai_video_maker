import React from 'react';
import { App } from 'antd';
import { CloseOutlined, ThunderboltOutlined } from '@ant-design/icons';
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
}

const PromptCard: React.FC<PromptCardProps> = ({ resource }) => {
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

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
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

      <button className={styles.generateButton} onClick={handleGenerate} title="生成">
        <ThunderboltOutlined />
        <span>生成</span>
      </button>
    </div>
  );
};

export default PromptCard;
