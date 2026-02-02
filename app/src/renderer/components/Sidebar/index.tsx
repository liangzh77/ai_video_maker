import React, { useState, useEffect } from 'react';
import { Button, Tooltip, App } from 'antd';
import { PlusOutlined, FolderOpenOutlined } from '@ant-design/icons';
import DraftList from './DraftList';
import { useDraftStore } from '../../stores/draft';
import styles from './Sidebar.module.css';

interface WorkspaceInfo {
  path: string;
  isDefault: boolean;
}

const Sidebar: React.FC = () => {
  const { message } = App.useApp();
  const { createDraft, selectDraft, loadDrafts } = useDraftStore();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);

  // 加载工作目录信息
  useEffect(() => {
    loadWorkspace();
  }, []);

  const loadWorkspace = async () => {
    try {
      const info = await window.api.config.getWorkspace();
      setWorkspace(info);
    } catch (error) {
      console.error('Failed to load workspace:', error);
    }
  };

  const handleCreateDraft = async () => {
    const draft = await createDraft('新项目');
    if (draft) {
      selectDraft(draft.id);
    }
  };

  const handleSelectWorkspace = async () => {
    try {
      const result = await window.api.config.selectWorkspace();
      if (result.success && result.data) {
        setWorkspace({
          path: result.data,
          isDefault: false,
        });
        message.success('工作目录已更新');
        // 重新加载草稿列表
        await loadDrafts();
      } else if (result.error !== 'CANCELED') {
        message.error('选择工作目录失败: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to select workspace:', error);
      message.error('选择工作目录失败');
    }
  };

  // 获取显示的路径（截取最后部分）
  const getDisplayPath = (fullPath: string): string => {
    if (!fullPath) return '';
    // 取最后两级目录
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) {
      return fullPath;
    }
    return '.../' + parts.slice(-2).join('/');
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <h1 className={styles.logo}>视频工坊</h1>
      </div>

      {/* 工作目录显示 */}
      <div className={styles.workspaceSection}>
        <Tooltip title={workspace?.path || '加载中...'} placement="right">
          <button
            className={styles.workspaceButton}
            onClick={handleSelectWorkspace}
          >
            <FolderOpenOutlined className={styles.workspaceIcon} />
            <span className={styles.workspacePath}>
              {workspace ? getDisplayPath(workspace.path) : '加载中...'}
            </span>
          </button>
        </Tooltip>
      </div>

      <div className={styles.actions}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreateDraft}
          className={styles.createButton}
          block
        >
          新建草稿
        </Button>
      </div>

      <div className={styles.content}>
        <DraftList />
      </div>
    </div>
  );
};

export default Sidebar;
