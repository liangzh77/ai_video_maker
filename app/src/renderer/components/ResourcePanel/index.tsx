import React from 'react';
import { useDraftStore } from '../../stores/draft';
import ResourceSection from './ResourceSection';
import styles from './ResourcePanel.module.css';

const ResourcePanel: React.FC = () => {
  const { selectedDraftId, getSelectedDraft, getResourcesByType } = useDraftStore();
  const selectedDraft = getSelectedDraft();

  if (!selectedDraftId) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>📁</div>
        <h3 className={styles.emptyTitle}>选择一个草稿</h3>
        <p className={styles.emptyDescription}>从左侧选择草稿或创建新草稿开始</p>
      </div>
    );
  }

  const sourceVideos = getResourcesByType('source_video');
  const sourceCharacters = getResourcesByType('source_character');
  const prompts = getResourcesByType('prompt');
  const newCharacters = getResourcesByType('new_character');
  const sceneSource = getResourcesByType('scene_source');
  const sceneNew = getResourcesByType('scene_new');
  const sceneHd = getResourcesByType('scene_hd');
  const lipsync = getResourcesByType('lipsync');
  const synthesized = getResourcesByType('synthesized');

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{selectedDraft?.name || '未命名草稿'}</h2>
      </div>

      <div className={styles.content}>
        <ResourceSection
          title="源视频"
          type="source_video"
          resources={sourceVideos}
          acceptFormats={['video/*']}
        />

        <ResourceSection
          title="源角色图片"
          type="source_character"
          resources={sourceCharacters}
          acceptFormats={['image/*']}
        />

        <ResourceSection
          title="提示词"
          type="prompt"
          resources={prompts}
          isText
        />

        <ResourceSection
          title="新角色图片"
          type="new_character"
          resources={newCharacters}
          badge="AI 生成"
        />

        <ResourceSection
          title="分镜源视频"
          type="scene_source"
          resources={sceneSource}
        />

        <ResourceSection
          title="分镜新视频"
          type="scene_new"
          resources={sceneNew}
          badge="待高清化"
        />

        <ResourceSection
          title="高清分镜新视频"
          type="scene_hd"
          resources={sceneHd}
          badge="4K·60fps"
          badgeType="success"
        />

        <ResourceSection
          title="对口型新视频"
          type="lipsync"
          resources={lipsync}
          badge="已同步"
        />

        <ResourceSection
          title="合成新视频"
          type="synthesized"
          resources={synthesized}
          isLarge
        />
      </div>
    </div>
  );
};

export default ResourcePanel;
