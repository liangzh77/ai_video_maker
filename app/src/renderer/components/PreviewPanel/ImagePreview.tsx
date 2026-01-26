import React, { useState } from 'react';
import type { Resource } from '@shared/types';
import styles from './ImagePreview.module.css';

interface ImagePreviewProps {
  src: string;
  resource: Resource;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ src, resource }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
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
          style={{ display: isLoading ? 'none' : 'block' }}
        />
      )}
    </div>
  );
};

export default ImagePreview;
