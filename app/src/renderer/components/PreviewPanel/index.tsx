import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Tooltip, Space } from 'antd';
import { FolderOpenOutlined, ScissorOutlined, SearchOutlined, ExpandOutlined } from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { useSplitPointsStore } from '../../stores/splitPoints';
import { usePlaybackStore, CONTINUOUS_PLAY_TYPES } from '../../stores/playback';
import { isVideoMetadata, isImageMetadata, isTextMetadata } from '@shared/types';
import type { ResourceType } from '@shared/types';
import VideoPlayer, { type VideoPlayerRef } from './VideoPlayer';
import ImagePreview from './ImagePreview';
import TextEditor from './TextEditor';
import ResourceInfo from './ResourceInfo';
import SplitVideoDialog from './SplitVideoDialog';
import AnalyzeVideoDialog from './AnalyzeVideoDialog';
import SplitPointEditorDialog from './SplitPointEditorDialog';
import styles from './PreviewPanel.module.css';

const PreviewPanel: React.FC = () => {
  const { selectedDraftId, selectedResourceId, getSelectedResource, openResourceFolder, selectResource, getResourcesByType } = useDraftStore();
  const { splitPoints, videoId, loadSplitPoints, clearPoints } = useSplitPointsStore();
  const { shouldAutoPlay, setShouldAutoPlay } = usePlaybackStore();
  const selectedResource = getSelectedResource();
  const [splitDialogVisible, setSplitDialogVisible] = useState(false);
  const [analyzeDialogVisible, setAnalyzeDialogVisible] = useState(false);
  const [editorDialogVisible, setEditorDialogVisible] = useState(false);
  const videoPlayerRef = useRef<VideoPlayerRef>(null);

  // 处理视频播放结束 - 自动播放下一个
  const handleVideoEnded = useCallback(() => {
    if (!selectedResource) return;

    // 只对支持连续播放的类型生效
    const resourceType = selectedResource.type as ResourceType;
    if (!CONTINUOUS_PLAY_TYPES.includes(resourceType as typeof CONTINUOUS_PLAY_TYPES[number])) {
      return;
    }

    // 获取同类型的所有资源（已按文件名排序）
    const resources = getResourcesByType(resourceType);
    const currentIndex = resources.findIndex((r) => r.id === selectedResource.id);

    // 找到下一个视频
    if (currentIndex >= 0 && currentIndex < resources.length - 1) {
      const nextResource = resources[currentIndex + 1];
      // 设置自动播放标志，然后选中下一个资源
      setShouldAutoPlay(true);
      selectResource(nextResource.id);
    }
  }, [selectedResource, getResourcesByType, setShouldAutoPlay, selectResource]);

  // 当资源切换后重置自动播放标志
  useEffect(() => {
    // 自动播放后重置标志（在下一帧），确保 VideoPlayer 已经收到 autoPlay=true
    if (shouldAutoPlay) {
      const timer = setTimeout(() => {
        setShouldAutoPlay(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedResourceId, shouldAutoPlay, setShouldAutoPlay]);

  // 全局空格键播放/暂停（仅对支持连续播放的视频类型生效）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框中的空格键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // 只响应空格键
      if (e.code !== 'Space') return;

      // 检查当前资源是否支持连续播放
      if (!selectedResource) return;
      const isContinuousPlayable = selectedResource.mimeType.startsWith('video/') &&
        CONTINUOUS_PLAY_TYPES.includes(selectedResource.type as typeof CONTINUOUS_PLAY_TYPES[number]);

      if (!isContinuousPlayable) return;

      e.preventDefault();
      videoPlayerRef.current?.togglePlay();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedResource]);

  // Auto-load split points when selecting a source video
  useEffect(() => {
    if (!selectedDraftId || !selectedResourceId || !selectedResource) {
      return;
    }

    // Only auto-load for source_video type
    if (selectedResource.type !== 'source_video') {
      return;
    }

    // Skip if already loaded for this video
    if (videoId === selectedResourceId && splitPoints.length > 0) {
      return;
    }

    // Try to load saved split points
    loadSplitPoints(selectedDraftId, selectedResourceId);
  }, [selectedDraftId, selectedResourceId, selectedResource, videoId, splitPoints.length, loadSplitPoints]);

  const handleOpenFolder = async () => {
    if (selectedResourceId) {
      await openResourceFolder(selectedResourceId);
    }
  };

  // Check if split points are for current video
  const hasSplitPoints = splitPoints.length > 0 && videoId === selectedResourceId;

  // Build local file URL - need triple slash for Windows paths
  const getLocalFileUrl = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return `local-file:///${normalizedPath}`;
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
            <Space size={0}>
              {/* Analyze button */}
              <Tooltip title="分析视频场景">
                <Button
                  type="text"
                  icon={<SearchOutlined />}
                  onClick={() => setAnalyzeDialogVisible(true)}
                />
              </Tooltip>
              {/* Split button - only enabled when has split points */}
              <Tooltip title={hasSplitPoints ? '切分视频' : '请先分析视频'}>
                <Button
                  type="text"
                  icon={<ScissorOutlined />}
                  onClick={() => setSplitDialogVisible(true)}
                  disabled={!hasSplitPoints}
                />
              </Tooltip>
              {/* Editor button - only enabled when has split points */}
              <Tooltip title={hasSplitPoints ? '放大编辑分割点' : '请先分析视频'}>
                <Button
                  type="text"
                  icon={<ExpandOutlined />}
                  onClick={() => setEditorDialogVisible(true)}
                  disabled={!hasSplitPoints}
                />
              </Tooltip>
            </Space>
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
            ref={videoPlayerRef}
            src={getLocalFileUrl(selectedResource.filePath)}
            resource={selectedResource}
            showSplitTimeline={isSourceVideo && hasSplitPoints}
            onEnded={handleVideoEnded}
            autoPlay={shouldAutoPlay && CONTINUOUS_PLAY_TYPES.includes(selectedResource.type as typeof CONTINUOUS_PLAY_TYPES[number])}
          />
        )}

        {isImage && (
          <ImagePreview
            src={getLocalFileUrl(selectedResource.filePath)}
            resource={selectedResource}
          />
        )}

        {isText && (
          <TextEditor resource={selectedResource} />
        )}

        <ResourceInfo resource={selectedResource} />
      </div>

      {/* Analyze Video Dialog */}
      {isSourceVideo && (
        <AnalyzeVideoDialog
          visible={analyzeDialogVisible}
          resource={selectedResource}
          onClose={() => setAnalyzeDialogVisible(false)}
        />
      )}

      {/* Split Video Dialog */}
      {isSourceVideo && (
        <SplitVideoDialog
          visible={splitDialogVisible}
          resource={selectedResource}
          onClose={() => setSplitDialogVisible(false)}
        />
      )}

      {/* Split Point Editor Dialog */}
      {isSourceVideo && (
        <SplitPointEditorDialog
          visible={editorDialogVisible}
          src={getLocalFileUrl(selectedResource.filePath)}
          resource={selectedResource}
          onClose={() => setEditorDialogVisible(false)}
        />
      )}
    </div>
  );
};

export default PreviewPanel;
