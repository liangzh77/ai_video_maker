import React, { useEffect } from 'react';
import { Layout, App as AntdApp } from 'antd';
import Sidebar from './components/Sidebar';
import ResourcePanel from './components/ResourcePanel';
import PreviewPanel from './components/PreviewPanel';
import NotificationBar from './components/NotificationBar';
import FullscreenPreviewModal from './components/FullscreenPreviewModal';
import { useDraftStore } from './stores/draft';
import { useAuthStore } from './stores/auth';
import { useGenerationStore } from './stores/generation';
import styles from './App.module.css';

const { Sider, Content } = Layout;

const AppContent: React.FC = () => {
  const { loadDrafts, selectedDraftId } = useDraftStore();
  const initAuth = useAuthStore((s) => s.init);
  const loadGenerationTasks = useGenerationStore((s) => s.loadTasksForDraft);
  useEffect(() => {
    initAuth();
    loadDrafts();
  }, [initAuth, loadDrafts]);

  useEffect(() => {
    if (selectedDraftId) {
      loadGenerationTasks(selectedDraftId);
    }
  }, [selectedDraftId, loadGenerationTasks]);

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
