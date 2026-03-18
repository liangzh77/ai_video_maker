import React, { useState, useEffect } from 'react';
import { Input, InputNumber, Dropdown, Modal, message } from 'antd';
import type { MenuProps } from 'antd';
import { MoreOutlined, EditOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import type { Draft } from '@shared/types';
import { useDraftStore } from '../../stores/draft';
import { useSectionsStore } from '../../stores/sections';
import styles from './DraftItem.module.css';

interface DraftItemProps {
  draft: Draft;
  isSelected: boolean;
}

const DraftItem: React.FC<DraftItemProps> = ({ draft, isSelected }) => {
  const { selectDraft, updateDraft, deleteDraft, copyDraft, resources } = useDraftStore();
  const { sections } = useSectionsStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(draft.name);
  const [copyDialogVisible, setCopyDialogVisible] = useState(false);
  const [copyCount, setCopyCount] = useState(1);
  const [isCopying, setIsCopying] = useState(false);
  const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);

  // 选中草稿的资源/卡片栏变化时，重新计算缩略图刷新 key
  const thumbRefreshKey = isSelected
    ? `${sections.map((s) => s.id).join(',')}_${resources.map((r) => r.id).join(',')}`
    : '';

  // 加载草稿缩略图
  useEffect(() => {
    let cancelled = false;
    setThumbnailPath(null);
    window.api.draft.getThumbnail({ draftId: draft.id }).then((result) => {
      if (!cancelled && result.success && result.data) {
        setThumbnailPath(result.data);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [draft.id, draft.updatedAt, thumbRefreshKey]);

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

  const handleCopy = async () => {
    if (copyCount < 1 || copyCount > 20) {
      message.error('复制份数必须在 1-20 之间');
      return;
    }

    setIsCopying(true);
    try {
      const copiedDrafts = await copyDraft(draft.id, copyCount);
      if (copiedDrafts) {
        message.success(`已复制 ${copiedDrafts.length} 份草稿`);
        setCopyDialogVisible(false);
        setCopyCount(1);
      } else {
        message.error('复制失败');
      }
    } catch {
      message.error('复制失败');
    } finally {
      setIsCopying(false);
    }
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: '重命名',
      onClick: (e) => {
        e.domEvent.stopPropagation();
        setEditName(draft.name);
        // 延迟设置编辑状态，确保菜单关闭后再显示输入框
        setTimeout(() => {
          setIsEditing(true);
        }, 100);
      },
    },
    {
      key: 'copy',
      icon: <CopyOutlined />,
      label: '复制',
      onClick: (e) => {
        e.domEvent.stopPropagation();
        setCopyDialogVisible(true);
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
      onClick: (e) => {
        e.domEvent.stopPropagation();
        handleDelete();
      },
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
    <>
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

        {thumbnailPath && (
          <img
            className={styles.thumbnail}
            src={`local-file:///${thumbnailPath.replace(/\\/g, '/')}`}
            alt=""
          />
        )}

        <Dropdown menu={{ items: menuItems }} trigger={['click']}>
          <button
            className={styles.menuButton}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreOutlined />
          </button>
        </Dropdown>
      </div>

      {/* 复制对话框 */}
      <Modal
        title="复制草稿"
        open={copyDialogVisible}
        onOk={handleCopy}
        onCancel={() => {
          setCopyDialogVisible(false);
          setCopyCount(1);
        }}
        okText="复制"
        cancelText="取消"
        confirmLoading={isCopying}
        width={360}
      >
        <div style={{ padding: '16px 0' }}>
          <p style={{ marginBottom: 12 }}>
            将"{draft.name}"复制 {copyCount} 份
          </p>
          <p style={{ marginBottom: 16, color: 'var(--color-text-secondary)', fontSize: 13 }}>
            新草稿命名格式：{draft.name}-1, {draft.name}-2 ...
            <br />
            <span style={{ fontSize: 12 }}>（如有重名将自动调整编号）</span>
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>复制份数：</span>
            <InputNumber
              min={1}
              max={20}
              value={copyCount}
              onChange={(value) => setCopyCount(value || 1)}
              style={{ width: 80 }}
            />
            <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
              （最多 20 份）
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default DraftItem;
