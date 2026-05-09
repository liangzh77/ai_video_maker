import React, { useState, useEffect } from 'react';
import { Badge, Button, Tooltip, Dropdown, App, Input } from 'antd';
import { PlusOutlined, FolderOpenOutlined, ClockCircleOutlined, SortAscendingOutlined, SortDescendingOutlined, ReloadOutlined, AppstoreOutlined, ThunderboltOutlined, DashboardOutlined, UserOutlined, LogoutOutlined, KeyOutlined, DeleteOutlined } from '@ant-design/icons';
import DraftList from './DraftList';
import MultiVideoDropZone from './MultiVideoDropZone';
import TemplateDialog, { getTemplate } from './TemplateDialog';
import GenerateImageDialog from '../PreviewPanel/GenerateImageDialog';
import LoginModal from './LoginModal';
import { useDraftStore, type DraftSortBy } from '../../stores/draft';
import { useGenerationStore } from '../../stores/generation';
import { useAuthStore } from '../../stores/auth';
import styles from './Sidebar.module.css';

interface WorkspaceInfo {
  path: string;
  isDefault: boolean;
}

const Sidebar: React.FC = () => {
  const { message, modal } = App.useApp();
  const { createDraft, selectDraft, loadDrafts, loadResources, selectedDraftId, sortBy, sortOrder, setSortBy } = useDraftStore();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [generateDialogInitialMode, setGenerateDialogInitialMode] = useState<'image' | 'text' | 'video' | 'tasks' | undefined>(undefined);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const activeTaskCount = useGenerationStore((s) => s.tasks.filter((t) => t.status === 'running' || t.status === 'pending').length);
  const { isLoggedIn, username, logout, resetPassword, deleteAccount } = useAuthStore();

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
      // 按模板创建 section（直接调用 API，不经过 store，避免与旧草稿 sections 混合产生重复 key）
      const template = getTemplate();
      for (const item of template) {
        await window.api.section.create({ draftId: draft.id, mediaType: item.mediaType, label: item.label });
      }
      // selectDraft 会触发 loadSections，加载新草稿的正确 sections
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
        // 先取消选中当前草稿（旧工作目录的草稿在新目录中不存在）
        await selectDraft(null);
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

  // 获取排序图标
  const getSortIcon = (type: DraftSortBy) => {
    if (sortBy !== type) return null;
    return sortOrder === 'asc' ? <SortAscendingOutlined /> : <SortDescendingOutlined />;
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <h1 className={styles.logo}>视频工坊</h1>
        <div className={styles.userArea}>
          {isLoggedIn ? (
            <Dropdown
              menu={{
                items: [
                  { key: 'resetPassword', icon: <KeyOutlined />, label: '重置密码' },
                  { key: 'deleteAccount', icon: <DeleteOutlined />, label: '注销账号', danger: true },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') {
                    logout();
                  } else if (key === 'resetPassword') {
                    let password = '';
                    modal.confirm({
                      title: '重置密码',
                      content: (
                        <Input.Password
                          placeholder="新密码"
                          onChange={(event) => { password = event.target.value; }}
                        />
                      ),
                      onOk: async () => {
                        if (!password) {
                          message.error('请输入新密码');
                          return Promise.reject();
                        }
                        const ok = await resetPassword(password);
                        if (ok) message.success('密码已重置');
                      },
                    });
                  } else if (key === 'deleteAccount') {
                    modal.confirm({
                      title: '确认注销账号？',
                      content: '注销后 Keychain 中的托管用户会被删除，本地登录态也会清除。',
                      okText: '注销账号',
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        const ok = await deleteAccount();
                        if (ok) message.success('账号已注销');
                      },
                    });
                  }
                },
              }}
              placement="bottomRight"
            >
              <Button type="text" size="small" icon={<UserOutlined />} className={styles.userButton}>
                {username}
              </Button>
            </Dropdown>
          ) : (
            <Tooltip title="登录后可使用AI功能">
              <Button type="text" size="small" icon={<UserOutlined />} onClick={() => setLoginModalOpen(true)} className={styles.userButton}>
                登录
              </Button>
            </Tooltip>
          )}
        </div>
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
        <Tooltip title="刷新工作目录" placement="right">
          <button
            className={styles.refreshButton}
            onClick={async () => {
              await loadWorkspace();
              await loadDrafts();
              if (selectedDraftId) {
                await loadResources(selectedDraftId);
              }
              message.success('已刷新');
            }}
          >
            <ReloadOutlined />
          </button>
        </Tooltip>
      </div>

      <div className={styles.actions}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreateDraft}
          className={styles.createButton}
        >
          新建草稿
        </Button>
        <Button
          icon={<AppstoreOutlined />}
          onClick={() => setTemplateDialogOpen(true)}
          className={styles.templateButton}
        >
          草稿模板
        </Button>
      </div>
      <div className={styles.generateRow}>
        <Button
          icon={<ThunderboltOutlined />}
          onClick={() => {
            setGenerateDialogInitialMode(undefined);
            setGenerateDialogOpen(true);
          }}
          disabled={!selectedDraftId}
          className={styles.generateButton}
        >
          生成
        </Button>
        <div className={styles.tasksButtonWrapper}>
          <Badge count={activeTaskCount} size="small" offset={[-4, 4]}>
            <Button
              icon={<DashboardOutlined />}
              onClick={() => {
                setGenerateDialogInitialMode('tasks');
                setGenerateDialogOpen(true);
              }}
              disabled={!selectedDraftId}
              className={styles.tasksButton}
              block
            >
              进行中
            </Button>
          </Badge>
        </div>
      </div>

      <TemplateDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
      />

      <GenerateImageDialog
        visible={generateDialogOpen}
        initialMode={generateDialogInitialMode}
        onClose={() => setGenerateDialogOpen(false)}
      />

      {/* 排序选择 */}
      <div className={styles.sortSection}>
        <Tooltip title={`按时间排序${sortBy === 'updatedAt' ? (sortOrder === 'desc' ? '（最新在前）' : '（最旧在前）') : ''}`}>
          <button
            className={`${styles.sortButton} ${sortBy === 'updatedAt' ? styles.sortButtonActive : ''}`}
            onClick={() => setSortBy('updatedAt')}
          >
            <ClockCircleOutlined />
            <span>时间</span>
            {getSortIcon('updatedAt')}
          </button>
        </Tooltip>
        <Tooltip title={`按名称排序${sortBy === 'name' ? (sortOrder === 'asc' ? '（A-Z）' : '（Z-A）') : ''}`}>
          <button
            className={`${styles.sortButton} ${sortBy === 'name' ? styles.sortButtonActive : ''}`}
            onClick={() => setSortBy('name')}
          >
            <span>名称</span>
            {getSortIcon('name')}
          </button>
        </Tooltip>
      </div>

      <div className={styles.content}>
        <DraftList />
      </div>

      {/* 多视频播放区域 */}
      <MultiVideoDropZone />

      {/* 登录弹窗 */}
      <LoginModal open={loginModalOpen} onClose={() => setLoginModalOpen(false)} />
    </div>
  );
};

export default Sidebar;
