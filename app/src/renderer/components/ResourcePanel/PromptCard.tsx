import React from 'react';
import { App } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { Resource } from '@shared/types';
import { isTextMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './PromptCard.module.css';

interface PromptCardProps {
  resource: Resource;
}

const PromptCard: React.FC<PromptCardProps> = ({ resource }) => {
  const { selectedResourceId, selectResource, deleteResource } = useDraftStore();
  const { message } = App.useApp();
  const isSelected = selectedResourceId === resource.id;

  const content = isTextMetadata(resource.metadata)
    ? resource.metadata.content
    : '';

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

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
    >
      <div className={styles.content}>
        {content || <span className={styles.empty}>暂无内容</span>}
      </div>
      <div className={styles.actions}>
        <button
          className={`${styles.actionButton} ${styles.deleteButton}`}
          onClick={handleDelete}
          title="删除"
        >
          <DeleteOutlined />
        </button>
      </div>
    </div>
  );
};

export default PromptCard;
