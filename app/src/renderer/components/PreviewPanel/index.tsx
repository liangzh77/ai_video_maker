import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Tooltip, Space, App } from 'antd';
import { FolderOpenOutlined, ScissorOutlined, SearchOutlined, ExpandOutlined, EditOutlined, LinkOutlined, SoundOutlined, PlaySquareOutlined } from '@ant-design/icons';
import { useDraftStore } from '../../stores/draft';
import { useSplitPointsStore } from '../../stores/splitPoints';
import { usePlaybackStore, CONTINUOUS_PLAY_TYPES } from '../../stores/playback';
import { useSceneLinkStore, SORTABLE_TYPES, type SortableType } from '../../stores/sceneLink';
import { isVideoMetadata, isImageMetadata, isTextMetadata } from '@shared/types';
import type { ResourceType, VideoMetadata, Resource } from '@shared/types';
import VideoPlayer, { type VideoPlayerRef } from './VideoPlayer';
import ImagePreview from './ImagePreview';
import TextEditor from './TextEditor';
import ResourceInfo from './ResourceInfo';
import SplitVideoDialog from './SplitVideoDialog';
import AnalyzeVideoDialog from './AnalyzeVideoDialog';
import SplitPointEditorDialog from './SplitPointEditorDialog';
import SceneBoundaryEditorDialog from './SceneBoundaryEditorDialog';
import DualVideoPlayerDialog from './DualVideoPlayerDialog';
import styles from './PreviewPanel.module.css';

const PreviewPanel: React.FC = () => {
  const { message } = App.useApp();
  const { selectedDraftId, selectedResourceId, getSelectedResource, openResourceFolder, selectResource, getResourcesByType, loadResources } = useDraftStore();
  const { splitPoints, videoId, loadSplitPoints, clearPoints } = useSplitPointsStore();
  const { shouldAutoPlay, setShouldAutoPlay, activePlayerType } = usePlaybackStore();
  const { getCustomOrder, getLinkedId } = useSceneLinkStore();
  const selectedResource = getSelectedResource();
  const [splitDialogVisible, setSplitDialogVisible] = useState(false);
  const [analyzeDialogVisible, setAnalyzeDialogVisible] = useState(false);
  const [editorDialogVisible, setEditorDialogVisible] = useState(false);
  const [boundaryEditorVisible, setBoundaryEditorVisible] = useState(false);
  const [dualPlayerVisible, setDualPlayerVisible] = useState(false);
  const videoPlayerRef = useRef<VideoPlayerRef>(null);

  // 获取按自定义排序的资源列表
  const getSortedResources = useCallback((resourceType: ResourceType) => {
    const resources = getResourcesByType(resourceType);
    if (!SORTABLE_TYPES.includes(resourceType as SortableType)) {
      return resources;
    }

    const customOrder = getCustomOrder(resourceType as SortableType);
    if (!customOrder) return resources;

    // 按自定义排序重新排列资源
    const resourceMap = new Map(resources.map((r) => [r.id, r]));
    const sorted = [];
    for (const id of customOrder) {
      const resource = resourceMap.get(id);
      if (resource) {
        sorted.push(resource);
      }
    }
    // 添加不在排序中的资源
    for (const resource of resources) {
      if (!customOrder.includes(resource.id)) {
        sorted.push(resource);
      }
    }
    return sorted;
  }, [getResourcesByType, getCustomOrder]);

  // 获取分镜源视频相关的信息（源视频、前后分镜）
  const getSceneRelatedResources = useCallback((sceneResource: Resource) => {
    const meta = sceneResource.metadata as VideoMetadata;
    if (!meta.sourceVideoId) {
      return { sourceVideo: null, prevScene: null, nextScene: null };
    }

    // 获取源视频
    const allResources = getResourcesByType('source_video');
    const sourceVideo = allResources.find(r => r.id === meta.sourceVideoId) || null;

    // 获取同一源视频的所有分镜
    const sceneSourceResources = getResourcesByType('scene_source');
    const relatedScenes = sceneSourceResources
      .filter(r => {
        const rMeta = r.metadata as VideoMetadata;
        return rMeta.sourceVideoId === meta.sourceVideoId;
      })
      .sort((a, b) => {
        const aMeta = a.metadata as VideoMetadata;
        const bMeta = b.metadata as VideoMetadata;
        return (aMeta.sceneIndex || 0) - (bMeta.sceneIndex || 0);
      });

    const currentIndex = relatedScenes.findIndex(r => r.id === sceneResource.id);
    const prevScene = currentIndex > 0 ? relatedScenes[currentIndex - 1] : null;
    const nextScene = currentIndex < relatedScenes.length - 1 ? relatedScenes[currentIndex + 1] : null;

    return { sourceVideo, prevScene, nextScene };
  }, [getResourcesByType]);

  // 处理重切分镜
  const handleResplitScene = useCallback(async (startTime: number, endTime: number) => {
    if (!selectedDraftId || !selectedResourceId) {
      throw new Error('No draft or resource selected');
    }

    const result = await window.api.task.resplitScene({
      draftId: selectedDraftId,
      sceneResourceId: selectedResourceId,
      newStartTime: startTime,
      newEndTime: endTime,
    });

    if (!result.success) {
      throw new Error(result.error || 'Resplit failed');
    }

    // 刷新资源列表
    await loadResources(selectedDraftId);
  }, [selectedDraftId, selectedResourceId, loadResources]);

  // 处理视频播放结束 - 自动播放下一个
  const handleVideoEnded = useCallback(() => {
    if (!selectedResource) return;

    // 只有当预览播放器是活跃播放器时，才触发连续播放
    // 如果边界编辑对话框正在播放，不触发连续播放
    if (activePlayerType !== 'preview') {
      return;
    }

    // 只对支持连续播放的类型生效
    const resourceType = selectedResource.type as ResourceType;
    if (!CONTINUOUS_PLAY_TYPES.includes(resourceType as typeof CONTINUOUS_PLAY_TYPES[number])) {
      return;
    }

    // 获取同类型的所有资源（使用自定义排序）
    const resources = getSortedResources(resourceType);
    const currentIndex = resources.findIndex((r) => r.id === selectedResource.id);

    // 找到下一个视频
    if (currentIndex >= 0 && currentIndex < resources.length - 1) {
      const nextResource = resources[currentIndex + 1];
      // 设置自动播放标志，然后选中下一个资源
      setShouldAutoPlay(true);
      selectResource(nextResource.id);
    }
  }, [selectedResource, getSortedResources, setShouldAutoPlay, selectResource, activePlayerType]);

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
      // 如果对话框打开，不响应空格键（由对话框自己处理）
      if (dualPlayerVisible || boundaryEditorVisible || editorDialogVisible) {
        return;
      }

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
  }, [selectedResource, dualPlayerVisible, boundaryEditorVisible, editorDialogVisible]);

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

  // 处理手动关联源视频（为旧版本分镜补充缺失的 metadata）
  const handleLinkSourceVideo = useCallback(async () => {
    if (!selectedDraftId || !selectedResourceId || !selectedResource) return;

    // 获取所有源视频
    const sourceVideos = getResourcesByType('source_video');
    if (sourceVideos.length === 0) {
      message.warning('没有可用的源视频');
      return;
    }

    // 如果只有一个源视频，直接关联
    const sourceVideo = sourceVideos[0];
    const meta = selectedResource.metadata as VideoMetadata;

    // 获取该源视频的所有分镜，计算当前分镜的位置
    const allScenes = getResourcesByType('scene_source');
    const sceneIndex = allScenes.findIndex(r => r.id === selectedResourceId) + 1;

    // 估算时间范围：使用分镜自身的 duration
    const duration = meta.duration || 0;
    // 如果有多个分镜，尝试根据序号估算 startTime
    let startTime = 0;
    for (let i = 0; i < sceneIndex - 1; i++) {
      const prevMeta = allScenes[i].metadata as VideoMetadata;
      startTime += prevMeta.duration || 0;
    }
    const endTime = startTime + duration;

    try {
      // 更新资源 metadata
      const result = await window.api.resource.update({
        id: selectedResourceId,
        metadata: {
          ...meta,
          sourceVideoId: sourceVideo.id,
          startTime,
          endTime,
          sceneIndex,
        },
      });

      if (!result.success) {
        throw new Error(result.error || 'Update failed');
      }

      message.success('已关联源视频，现在可以编辑边界了');
      // 刷新资源列表
      await loadResources(selectedDraftId);
    } catch (error) {
      message.error('关联失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  }, [selectedDraftId, selectedResourceId, selectedResource, getResourcesByType, loadResources, message]);

  // 处理提取音频
  const handleExtractAudio = useCallback(async () => {
    if (!selectedDraftId || !selectedResourceId) return;

    try {
      const result = await window.api.task.extractAudio({
        draftId: selectedDraftId,
        videoResourceId: selectedResourceId,
      });

      if (!result.success) {
        if (result.error === 'CANCELLED: User cancelled save dialog') {
          // 用户取消，不显示错误
          return;
        }
        throw new Error(result.error || 'Extract audio failed');
      }

      message.success('音频已保存');
    } catch (error) {
      message.error('提取音频失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  }, [selectedDraftId, selectedResourceId, message]);

  // Check if split points are for current video
  const hasSplitPoints = splitPoints.length > 0 && videoId === selectedResourceId;

  // Build local file URL - need triple slash for Windows paths
  // 添加 fileSize 作为缓存参数，确保文件更新后能重新加载
  const getLocalFileUrl = (filePath: string, fileSize?: number) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const cacheKey = fileSize ? `?v=${fileSize}` : '';
    return `local-file:///${normalizedPath}${cacheKey}`;
  };

  // 获取关联的视频资源（用于双视频对比播放）
  // 注意：useMemo 必须在 early return 之前调用
  const linkedVideoResource = useMemo(() => {
    if (!selectedResource) return null;
    const isSceneSourceType = selectedResource.type === 'scene_source';
    const isSceneNewType = selectedResource.type === 'scene_new';
    if (!isSceneSourceType && !isSceneNewType) return null;

    const linkedId = getLinkedId(
      selectedResource.id,
      isSceneSourceType ? 'scene_source' : 'scene_new'
    );
    if (!linkedId) return null;

    // 从对应类型中查找关联资源
    const linkedType = isSceneSourceType ? 'scene_new' : 'scene_source';
    const linkedResources = getResourcesByType(linkedType);
    return linkedResources.find(r => r.id === linkedId) || null;
  }, [selectedResource, getLinkedId, getResourcesByType]);

  // 准备双视频播放所需的资源
  const dualPlayerResources = useMemo(() => {
    if (!linkedVideoResource || !selectedResource) return null;

    const isSceneSourceType = selectedResource.type === 'scene_source';
    // 确保 sourceResource 是 scene_source，newResource 是 scene_new
    if (isSceneSourceType) {
      return {
        sourceResource: selectedResource,
        newResource: linkedVideoResource,
      };
    } else {
      return {
        sourceResource: linkedVideoResource,
        newResource: selectedResource,
      };
    }
  }, [selectedResource, linkedVideoResource]);

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
  const isSceneSource = selectedResource.type === 'scene_source';
  const isSceneNew = selectedResource.type === 'scene_new';

  // 获取分镜相关资源（仅当选中分镜源视频时）
  const sceneRelated = isSceneSource ? getSceneRelatedResources(selectedResource) : null;
  const canEditBoundary = isSceneSource && sceneRelated?.sourceVideo;

  // 检查分镜是否缺少源视频关联（需要手动关联）
  const sceneMeta = isSceneSource ? (selectedResource.metadata as VideoMetadata) : null;
  const needsSourceLink = isSceneSource && !sceneMeta?.sourceVideoId;

  // 检查视频是否有音频（用于显示保存音频按钮）
  const videoMeta = isVideo && isVideoMetadata(selectedResource.metadata) ? selectedResource.metadata : null;
  const hasAudio = videoMeta?.hasAudio;

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
          {needsSourceLink && (
            <Tooltip title="关联源视频（用于编辑边界）">
              <Button
                type="text"
                icon={<LinkOutlined />}
                onClick={handleLinkSourceVideo}
              />
            </Tooltip>
          )}
          {canEditBoundary && (
            <Tooltip title="编辑分镜边界">
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => setBoundaryEditorVisible(true)}
              />
            </Tooltip>
          )}
          {isVideo && hasAudio && (
            <Tooltip title="保存音频">
              <Button
                type="text"
                icon={<SoundOutlined />}
                onClick={handleExtractAudio}
              />
            </Tooltip>
          )}
          {dualPlayerResources && (
            <Tooltip title="对比播放（源/新）">
              <Button
                type="text"
                icon={<PlaySquareOutlined />}
                onClick={() => {
                  // 先暂停主视频播放器
                  videoPlayerRef.current?.pause();
                  setDualPlayerVisible(true);
                }}
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
            ref={videoPlayerRef}
            src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
            resource={selectedResource}
            showSplitTimeline={isSourceVideo && hasSplitPoints}
            onEnded={handleVideoEnded}
            autoPlay={shouldAutoPlay && CONTINUOUS_PLAY_TYPES.includes(selectedResource.type as typeof CONTINUOUS_PLAY_TYPES[number])}
          />
        )}

        {isImage && (
          <ImagePreview
            src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
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
          src={getLocalFileUrl(selectedResource.filePath, selectedResource.fileSize)}
          resource={selectedResource}
          onClose={() => setEditorDialogVisible(false)}
        />
      )}

      {/* Scene Boundary Editor Dialog */}
      {canEditBoundary && sceneRelated?.sourceVideo && (
        <SceneBoundaryEditorDialog
          visible={boundaryEditorVisible}
          sceneResource={selectedResource}
          sourceVideoResource={sceneRelated.sourceVideo}
          prevSceneResource={sceneRelated.prevScene || undefined}
          nextSceneResource={sceneRelated.nextScene || undefined}
          onClose={() => setBoundaryEditorVisible(false)}
          onConfirm={handleResplitScene}
        />
      )}

      {/* Dual Video Player Dialog */}
      {dualPlayerResources && (
        <DualVideoPlayerDialog
          visible={dualPlayerVisible}
          sourceResource={dualPlayerResources.sourceResource}
          newResource={dualPlayerResources.newResource}
          onClose={() => setDualPlayerVisible(false)}
        />
      )}
    </div>
  );
};

export default PreviewPanel;
