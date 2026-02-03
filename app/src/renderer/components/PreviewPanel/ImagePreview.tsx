import React, { useState } from 'react';
import { Modal } from 'antd';
import type { Resource } from '@shared/types';
import styles from './ImagePreview.module.css';

interface ImagePreviewProps {
  src: string;
  resource: Resource;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ src, resource }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleDoubleClick = () => {
    if (!hasError) {
      setFullscreenVisible(true);
    }
  };

  return (
    <div className={styles.container}>
      {isLoading && <div className={styles.loading}>加载中...</div>}

      {hasError ? (
        <div className={styles.error}>
          <span>无法加载图片</span>
        </div>
      ) : (
        <img
          src={src}
          alt={resource.fileName}
          className={styles.image}
          onLoad={handleLoad}
          onError={handleError}
          onDoubleClick={handleDoubleClick}
          style={{ display: isLoading ? 'none' : 'block', cursor: 'pointer' }}
          title="双击放大查看"
        />
      )}

      {/* 大图预览 Modal */}
      <Modal
        open={fullscreenVisible}
        onCancel={() => setFullscreenVisible(false)}
        footer={null}
        width="90vw"
        centered
        className={styles.fullscreenModal}
        styles={{
          body: {
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxHeight: '85vh',
            overflow: 'auto',
            backgroundColor: '#000',
          },
        }}
      >
        <img
          src={src}
          alt={resource.fileName}
          className={styles.fullscreenImage}
        />
      </Modal>
    </div>
  );
};

export default ImagePreview;
