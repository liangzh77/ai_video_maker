import React from 'react';
import { Empty, Spin } from 'antd';
import DraftItem from './DraftItem';
import { useDraftStore } from '../../stores/draft';
import styles from './DraftList.module.css';

const DraftList: React.FC = () => {
  const { drafts, selectedDraftId, isLoading } = useDraftStore();

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spin size="small" />
        <span>加载中...</span>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无草稿"
        className={styles.empty}
      />
    );
  }

  return (
    <div className={styles.list}>
      {drafts.map((draft) => (
        <DraftItem
          key={draft.id}
          draft={draft}
          isSelected={draft.id === selectedDraftId}
        />
      ))}
    </div>
  );
};

export default DraftList;
