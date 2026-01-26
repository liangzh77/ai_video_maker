import React, { useState } from 'react';
import { Input, Dropdown, Modal, message } from 'antd';
import type { MenuProps } from 'antd';
import { MoreOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { Draft } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import styles from './DraftItem.module.css';

interface DraftItemProps {
  draft: Draft;
  isSelected: boolean;
}

const DraftItem: React.FC<DraftItemProps> = ({ draft, isSelected }) => {
  const { selectDraft, updateDraft, deleteDraft, resources } = useDraftStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(draft.name);

  const handleClick = () => {
    if (!isEditing) {
      selectDraft(draft.id);
    }
  };

  const handleRename = async () => {
    if (editName.trim() && editName !== draft.name) {
      await updateDraft(draft.id, editName.trim());
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    Modal.confirm({
      title: '删除草稿',
      content: `确定要删除"${draft.name}"吗？此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const success = await deleteDraft(draft.id);
        if (success) {
          message.success('草稿已删除');
        } else {
          message.error('删除失败');
        }
      },
    });
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: '重命名',
      onClick: () => {
        setEditName(draft.name);
        setIsEditing(true);
      },
    },
    {
      type: 'divider',
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: handleDelete,
    },
  ];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const resourceCount = isSelected ? resources.length : 0;

  return (
    <div
      className={`${styles.item} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
    >
      <div className={styles.content}>
        {isEditing ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onPressEnter={handleRename}
            autoFocus
            size="small"
            className={styles.input}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className={styles.name}>{draft.name}</div>
        )}

        <div className={styles.meta}>
          <span className={styles.date}>{formatDate(draft.updatedAt)}</span>
          {resourceCount > 0 && (
            <span className={styles.count}>{resourceCount} 项</span>
          )}
        </div>
      </div>

      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <button
          className={styles.menuButton}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreOutlined />
        </button>
      </Dropdown>
    </div>
  );
};

export default DraftItem;
