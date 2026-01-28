import React, { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { FolderOpenOutlined, ScissorOutlined } from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { isVideoMetadata, isImageMetadata, isTextMetadata } from '@shared/types';
import VideoPlayer from './VideoPlayer';
import ImagePreview from './ImagePreview';
import TextEditor from './TextEditor';
import ResourceInfo from './ResourceInfo';
import SplitVideoDialog from './SplitVideoDialog';
import styles from './PreviewPanel.module.css';

const PreviewPanel: React.FC = () => {
  const { selectedResourceId, getSelectedResource, openResourceFolder } = useDraftStore();
  const selectedResource = getSelectedResource();
  const [splitDialogVisible, setSplitDialogVisible] = useState(false);

  const handleOpenFolder = async () => {
    if (selectedResourceId) {
      await openResourceFolder(selectedResourceId);
    }
  };

  if (!selectedResourceId || !selectedResource) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>👁️</div>
          <p className={styles.emptyText}>选择一个资源进行预览</p>
        </div>
      </div>
    );
  }

  const isVideo = selectedResource.mimeType.startsWith('video/');
  const isImage = selectedResource.mimeType.startsWith('image/');
  const isText = isTextMetadata(selectedResource.metadata);
  const isSourceVideo = selectedResource.type === 'source_video';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>预览</h3>
        <div className={styles.headerActions}>
          {isSourceVideo && (
            <Tooltip title="分割视频">
              <Button
                type="text"
                icon={<ScissorOutlined />}
                onClick={() => setSplitDialogVisible(true)}
              />
            </Tooltip>
          )}
          <Tooltip title="打开所在文件夹">
            <Button
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={handleOpenFolder}
            />
          </Tooltip>
        </div>
      </div>

      <div className={styles.content}>
        {isVideo && (
          <VideoPlayer
            src={`local-file://${encodeURIComponent(selectedResource.filePath)}`}
            resource={selectedResource}
          />
        )}

        {isImage && (
          <ImagePreview
            src={`local-file://${encodeURIComponent(selectedResource.filePath)}`}
            resource={selectedResource}
          />
        )}

        {isText && (
          <TextEditor resource={selectedResource} />
        )}

        <ResourceInfo resource={selectedResource} />
      </div>

      {/* Split Video Dialog */}
      {isSourceVideo && (
        <SplitVideoDialog
          visible={splitDialogVisible}
          resource={selectedResource}
          onClose={() => setSplitDialogVisible(false)}
        />
      )}
    </div>
  );
};

export default PreviewPanel;
