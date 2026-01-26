import React from 'react';
import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import DraftList from './DraftList';
import { useDraftStore } from '../../stores/draft';
import styles from './Sidebar.module.css';

const Sidebar: React.FC = () => {
  const { createDraft, selectDraft } = useDraftStore();

  const handleCreateDraft = async () => {
    const draft = await createDraft('新项目');
    if (draft) {
      selectDraft(draft.id);
    }
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <h1 className={styles.logo}>视频工坊</h1>
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
