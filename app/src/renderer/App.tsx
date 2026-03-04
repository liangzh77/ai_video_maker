import React, { useEffect } from 'react';
import { Layout, App as AntdApp } from 'antd';
import Sidebar from './components/Sidebar';
import ResourcePanel from './components/ResourcePanel';
import PreviewPanel from './components/PreviewPanel';
import NotificationBar from './components/NotificationBar';
import FullscreenPreviewModal from './components/FullscreenPreviewModal';
import { useDraftStore } from './stores/draft';
import { useAuthStore } from './stores/auth';
import styles from './App.module.css';

const { Sider, Content } = Layout;

const AppContent: React.FC = () => {
  const { loadDrafts, selectedDraftId } = useDraftStore();
  const initAuth = useAuthStore((s) => s.init);
  const { notification } = AntdApp.useApp();

  useEffect(() => {
    initAuth().then(() => {
      const { isLoggedIn, missingKeys } = useAuthStore.getState();
      if (isLoggedIn && missingKeys.length > 0) {
        notification.warning({
          message: '部分 API 密钥缺失',
          description: `以下服务的密钥未在云端配置，相关模型不可用：${missingKeys.map(k => k.label).join('、')}`,
          duration: 8,
        });
      }
    });
    loadDrafts();
  }, [initAuth, loadDrafts, notification]);

  return (
    <Layout className={styles.layout}>
      {/* Left Sidebar - Draft List */}
      <Sider width={280} className={styles.sidebar}>
        <Sidebar />
      </Sider>

      {/* Main Content Area */}
      <Layout className={styles.mainLayout}>
        {/* Center - Resource Panel */}
        <Content className={styles.content}>
          <ResourcePanel />
        </Content>

        {/* Right - Preview Panel */}
        {selectedDraftId && (
          <Sider width={420} className={styles.previewSider}>
            <PreviewPanel />
          </Sider>
        )}
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <AntdApp>
      <AppContent />
      <NotificationBar />
      <FullscreenPreviewModal />
    </AntdApp>
  );
};

export default App;
