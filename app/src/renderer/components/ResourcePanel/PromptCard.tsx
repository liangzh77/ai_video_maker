import React, { useState } from 'react';
import { Input, Button, message } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import type { Resource, TextMetadata } from '@shared/types';
import { isTextMetadata } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './PromptCard.module.css';

const { TextArea } = Input;

interface PromptCardProps {
  resource: Resource;
}

const PromptCard: React.FC<PromptCardProps> = ({ resource }) => {
  const { selectedResourceId, selectResource, updateResource } = useDraftStore();
  const isSelected = selectedResourceId === resource.id;
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  const content = isTextMetadata(resource.metadata)
    ? resource.metadata.content
    : '';

  const handleClick = () => {
    selectResource(resource.id);
  };

  const handleEdit = () => {
    setEditContent(content);
    setIsEditing(true);
  };

  const handleSave = async () => {
    const updatedMeta: TextMetadata = {
      content: editContent,
      encoding: 'utf-8',
    };
    const result = await updateResource(resource.id, updatedMeta);
    if (result) {
      message.success('保存成功');
    } else {
      message.error('保存失败');
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditContent('');
    setIsEditing(false);
  };

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
    >
      {isEditing ? (
        <div className={styles.editMode} onClick={(e) => e.stopPropagation()}>
          <TextArea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
            className={styles.textarea}
            autoFocus
          />
          <div className={styles.editActions}>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={handleCancel}
            >
              取消
            </Button>
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              onClick={handleSave}
            >
              保存
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.content}>
            {content || <span className={styles.empty}>暂无内容</span>}
          </div>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              handleEdit();
            }}
          >
            <EditOutlined />
          </button>
        </>
      )}
    </div>
  );
};

export default PromptCard;
